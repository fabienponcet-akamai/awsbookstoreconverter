/**
 * EdgeWorkers Middleware Wrapper
 *
 * This wrapper adapts Next.js middleware to run on Akamai EdgeWorkers.
 * EdgeWorkers provides:
 * - Global edge execution (4200+ PoPs)
 * - Sub-5ms cold starts
 * - Access to EdgeKV for distributed state
 *
 * The wrapper handles:
 * - Request/response conversion
 * - EdgeKV integration for session/state
 * - Geo-location and client hints
 * - Cache control headers
 */

import type {
  Wrapper,
  Converter,
  InternalEvent,
  InternalResult,
  RequestHandler,
  WrappedHandler,
} from "../types/index.js";

// ============================================================================
// EdgeWorkers Type Definitions
// ============================================================================

/**
 * EdgeWorkers request object
 * @see https://techdocs.akamai.com/edgeworkers/docs/request-object
 */
interface EdgeWorkersRequest {
  readonly method: string;
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  readonly query: string;
  readonly url: string;
  readonly userLocation: UserLocation;
  readonly device: DeviceInfo;
  readonly cacheKey: CacheKey;
  readonly cpCode: number;

  getHeader(name: string): string[] | null;
  getHeaders(): Headers;
  getVariable(name: string): string | undefined;
  setHeader(name: string, value: string): void;
  addHeader(name: string, value: string): void;
  removeHeader(name: string): void;
  setVariable(name: string, value: string): void;

  // Body methods (POST/PUT)
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface UserLocation {
  readonly continent: string;
  readonly country: string;
  readonly region: string;
  readonly city: string;
  readonly zipCode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly dma: number;
  readonly timezone: string;
  readonly networkType: string;
  readonly bandwidth: string;
  readonly areaCodes: string[];
}

interface DeviceInfo {
  readonly isMobile: boolean;
  readonly isTablet: boolean;
  readonly isDesktop: boolean;
  readonly isWireless: boolean;
  readonly brandName: string;
  readonly modelName: string;
  readonly os: string;
  readonly osVersion: string;
}

interface CacheKey {
  readonly includeQueryString: boolean;
  excludeQueryString(): void;
  includeQueryString(): void;
  includeQueryArgument(name: string): void;
  includeCookie(name: string): void;
  includeHeader(name: string): void;
  includeVariable(name: string): void;
}

/**
 * EdgeWorkers response object
 */
interface EdgeWorkersResponse {
  readonly status: number;
  readonly headers: Headers;

  setHeader(name: string, value: string): void;
  addHeader(name: string, value: string): void;
  removeHeader(name: string): void;
  getHeader(name: string): string[] | null;
}

/**
 * EdgeWorkers event handlers
 */
type ResponseProviderEvent = {
  request: EdgeWorkersRequest;
  respondWith(response: Promise<EdgeWorkersHttpResponse>): void;
};

interface EdgeWorkersHttpResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string | ArrayBuffer;
}

// ============================================================================
// Converter: EdgeWorkers Request/Response ↔ Internal Format
// ============================================================================

export function createEdgeWorkersConverter(): Converter {
  return {
    name: "edgeworkers-converter",

    convertFrom(event: unknown): InternalEvent {
      const ewRequest = event as EdgeWorkersRequest;

      // Parse query string
      const queryParams: Record<string, string | string[]> = {};
      if (ewRequest.query) {
        const searchParams = new URLSearchParams(ewRequest.query);
        searchParams.forEach((value, key) => {
          const existing = queryParams[key];
          if (existing) {
            if (Array.isArray(existing)) {
              existing.push(value);
            } else {
              queryParams[key] = [existing, value];
            }
          } else {
            queryParams[key] = value;
          }
        });
      }

      // Parse headers
      const headers: Record<string, string> = {};
      const ewHeaders = ewRequest.getHeaders();
      ewHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      // Parse cookies
      const cookies: Record<string, string> = {};
      const cookieHeader = headers["cookie"];
      if (cookieHeader) {
        cookieHeader.split(";").forEach((cookie) => {
          const [name, value] = cookie.trim().split("=");
          if (name && value) {
            cookies[name] = decodeURIComponent(value);
          }
        });
      }

      // Add geo information as headers (available in middleware)
      const geo = ewRequest.userLocation;
      headers["x-vercel-ip-country"] = geo.country;
      headers["x-vercel-ip-country-region"] = geo.region;
      headers["x-vercel-ip-city"] = geo.city;
      headers["x-vercel-ip-latitude"] = geo.latitude.toString();
      headers["x-vercel-ip-longitude"] = geo.longitude.toString();
      headers["x-vercel-ip-timezone"] = geo.timezone;

      // Add device information
      const device = ewRequest.device;
      if (device.isMobile) {
        headers["x-device-type"] = "mobile";
      } else if (device.isTablet) {
        headers["x-device-type"] = "tablet";
      } else {
        headers["x-device-type"] = "desktop";
      }

      return {
        type: "v2",
        method: ewRequest.method,
        rawPath: ewRequest.path,
        url: ewRequest.url,
        headers,
        query: queryParams,
        cookies,
        remoteAddress: ewRequest.getVariable("PMUSER_CLIENT_IP"),
      };
    },

    convertTo(result: InternalResult): EdgeWorkersHttpResponse {
      // Convert headers
      const headers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(result.headers)) {
        headers[key] = value;
      }

      // Decode body if base64 encoded
      let body: string | ArrayBuffer = result.body;
      if (result.isBase64Encoded) {
        // Convert base64 to ArrayBuffer for binary responses
        const binaryString = atob(result.body);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        body = bytes.buffer;
      }

      return {
        status: result.statusCode,
        headers,
        body,
      };
    },
  };
}

// ============================================================================
// Wrapper: Adapt handler for EdgeWorkers runtime
// ============================================================================

export function createEdgeWorkersWrapper(): Wrapper {
  const converter = createEdgeWorkersConverter();

  return {
    name: "edgeworkers-wrapper",

    wrap(handler: RequestHandler): WrappedHandler {
      // Return EdgeWorkers responseProvider handler
      return async (
        event: unknown
      ): Promise<EdgeWorkersHttpResponse> => {
        const ewRequest = event as EdgeWorkersRequest;

        try {
          // Convert EdgeWorkers request to internal format
          const internalEvent = converter.convertFrom(ewRequest);

          // Handle request body for POST/PUT
          if (
            ewRequest.method === "POST" ||
            ewRequest.method === "PUT" ||
            ewRequest.method === "PATCH"
          ) {
            const bodyText = await ewRequest.text();
            internalEvent.body = Buffer.from(bodyText);
          }

          // Call the Next.js middleware handler
          const result = await handler(internalEvent);

          // Convert result back to EdgeWorkers format
          return converter.convertTo(result);
        } catch (error) {
          console.error("[EdgeWorkers] Handler error:", error);

          // Return error response
          return {
            status: 500,
            headers: {
              "content-type": "text/plain",
            },
            body: "Internal Server Error",
          };
        }
      };
    },
  };
}

// Default export for OpenNext override system
const edgeworkersWrapper = createEdgeWorkersWrapper;
export default edgeworkersWrapper;

// ============================================================================
// EdgeWorkers Entry Point Generator
// ============================================================================

/**
 * Generate EdgeWorkers main.js entry point that wraps Next.js middleware
 */
export function generateEdgeWorkersBundle(middlewareCode: string): string {
  return `
// Generated by @opennextjs/akamai
// EdgeWorkers entry point for Next.js middleware

import { logger } from 'log';
import { EdgeKV } from './edgekv.js';
import { createCookies } from 'cookies';
import { TextEncoder, TextDecoder } from 'encoding';

// Polyfills for Next.js middleware
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// EdgeKV client for distributed state
const edgekv = new EdgeKV({ namespace: 'default', group: 'middleware' });

// Import compiled middleware
${middlewareCode}

// EdgeWorkers event handlers
export async function onClientRequest(request) {
  // Add timing header for debugging
  request.setHeader('x-edge-start-time', Date.now().toString());

  // Log request
  logger.log('Request: %s %s', request.method, request.path);
}

export async function responseProvider(request) {
  try {
    // Convert and handle request through Next.js middleware
    const response = await handleMiddleware(request);

    // Add timing header
    const startTime = parseInt(request.getHeader('x-edge-start-time')?.[0] || '0');
    if (startTime) {
      const duration = Date.now() - startTime;
      response.headers['x-edge-duration'] = duration.toString();
    }

    return response;
  } catch (error) {
    logger.error('Middleware error: %s', error.message);

    return {
      status: 500,
      headers: { 'content-type': 'text/plain' },
      body: 'Edge processing error'
    };
  }
}

export function onClientResponse(request, response) {
  // Add cache status header
  const cacheStatus = response.getHeader('x-cache');
  if (cacheStatus) {
    logger.log('Cache status: %s', cacheStatus.join(', '));
  }
}
`;
}

// ============================================================================
// EdgeKV Session Handler
// ============================================================================

/**
 * EdgeKV-based session handler for middleware
 */
export interface EdgeKVSession {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createEdgeKVSession(
  namespace: string,
  group: string
): EdgeKVSession {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      // In EdgeWorkers runtime, use native EdgeKV
      // @ts-expect-error - EdgeKV is only available in EdgeWorkers
      if (typeof EdgeKV !== "undefined") {
        // @ts-expect-error - EdgeKV is only available in EdgeWorkers
        const client = new EdgeKV({ namespace, group });
        const data = await client.getText({ item: key });
        if (!data) return null;
        return JSON.parse(data) as T;
      }
      return null;
    },

    async set<T = unknown>(
      key: string,
      value: T,
      ttl?: number
    ): Promise<void> {
      // @ts-expect-error - EdgeKV is only available in EdgeWorkers
      if (typeof EdgeKV !== "undefined") {
        // @ts-expect-error - EdgeKV is only available in EdgeWorkers
        const client = new EdgeKV({ namespace, group });
        await client.putText({
          item: key,
          value: JSON.stringify(value),
          expiry: ttl,
        });
      }
    },

    async delete(key: string): Promise<void> {
      // @ts-expect-error - EdgeKV is only available in EdgeWorkers
      if (typeof EdgeKV !== "undefined") {
        // @ts-expect-error - EdgeKV is only available in EdgeWorkers
        const client = new EdgeKV({ namespace, group });
        await client.delete({ item: key });
      }
    },
  };
}
