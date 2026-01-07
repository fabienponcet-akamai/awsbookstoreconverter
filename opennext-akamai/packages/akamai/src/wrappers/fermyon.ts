/**
 * Fermyon Spin Wrapper
 *
 * This wrapper adapts Next.js server functions to run on Fermyon Spin.
 * Fermyon Spin provides:
 * - WebAssembly-based serverless execution
 * - Sub-millisecond cold starts
 * - Scale-to-zero capabilities
 * - Integration with Akamai edge (post-acquisition)
 *
 * The wrapper handles:
 * - HTTP trigger request/response conversion
 * - Spin SDK integration
 * - Outbound HTTP for ISR revalidation
 * - Key-value store for caching
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
// Spin SDK Type Definitions
// ============================================================================

/**
 * Spin HTTP request object
 * @see https://developer.fermyon.com/spin/v3/javascript-components
 */
interface SpinRequest {
  method: string;
  uri: string;
  headers: [string, string][];
  body?: Uint8Array;
}

/**
 * Spin HTTP response object
 */
interface SpinResponse {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}

/**
 * Spin HTTP handler type
 */
type SpinHandler = (request: SpinRequest) => Promise<SpinResponse>;

/**
 * Spin Key-Value store interface
 */
interface SpinKv {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getKeys(): Promise<string[]>;
}

/**
 * Spin outbound HTTP interface
 */
interface SpinOutboundHttp {
  send(request: SpinRequest): Promise<SpinResponse>;
}

// ============================================================================
// Converter: Spin Request/Response ↔ Internal Format
// ============================================================================

export function createSpinConverter(): Converter {
  return {
    name: "spin-converter",

    convertFrom(event: unknown): InternalEvent {
      const spinRequest = event as SpinRequest;

      // Parse URL
      const url = new URL(spinRequest.uri, "http://localhost");

      // Parse query parameters
      const query: Record<string, string | string[]> = {};
      url.searchParams.forEach((value, key) => {
        const existing = query[key];
        if (existing) {
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            query[key] = [existing, value];
          }
        } else {
          query[key] = value;
        }
      });

      // Parse headers
      const headers: Record<string, string> = {};
      for (const [key, value] of spinRequest.headers) {
        headers[key.toLowerCase()] = value;
      }

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

      // Build internal event
      const internalEvent: InternalEvent = {
        type: "v2",
        method: spinRequest.method,
        rawPath: url.pathname,
        url: spinRequest.uri,
        headers,
        query,
        cookies,
        remoteAddress: headers["x-forwarded-for"]?.split(",")[0]?.trim(),
      };

      // Add body if present
      if (spinRequest.body && spinRequest.body.length > 0) {
        internalEvent.body = Buffer.from(spinRequest.body);
      }

      return internalEvent;
    },

    convertTo(result: InternalResult): SpinResponse {
      // Convert headers to Spin format
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.headers)) {
        if (Array.isArray(value)) {
          headers[key] = value.join(", ");
        } else {
          headers[key] = value;
        }
      }

      // Convert body
      let body: Uint8Array | string;
      if (result.isBase64Encoded) {
        // Decode base64 to binary
        const binaryString = atob(result.body);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        body = bytes;
      } else {
        body = result.body;
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
// Wrapper: Adapt handler for Spin runtime
// ============================================================================

export function createSpinWrapper(): Wrapper {
  const converter = createSpinConverter();

  return {
    name: "spin-wrapper",

    wrap(handler: RequestHandler): WrappedHandler {
      // Return Spin HTTP handler
      const spinHandler: SpinHandler = async (
        spinRequest: SpinRequest
      ): Promise<SpinResponse> => {
        const startTime = Date.now();

        try {
          // Convert Spin request to internal format
          const internalEvent = converter.convertFrom(spinRequest);

          // Call the Next.js server handler
          const result = await handler(internalEvent);

          // Add timing header
          const headers = result.headers as Record<string, string>;
          headers["x-spin-duration"] = `${Date.now() - startTime}ms`;

          // Convert result back to Spin format
          return converter.convertTo(result);
        } catch (error) {
          console.error("[Spin] Handler error:", error);

          return {
            status: 500,
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              error: "Internal Server Error",
              message:
                error instanceof Error ? error.message : "Unknown error",
            }),
          };
        }
      };

      return spinHandler as unknown as WrappedHandler;
    },
  };
}

// Default export for OpenNext override system
const spinWrapper = createSpinWrapper;
export default spinWrapper;

// ============================================================================
// Spin Entry Point Generator
// ============================================================================

/**
 * Generate spin.toml configuration file
 */
export function generateSpinToml(config: {
  appName: string;
  version?: string;
  components: {
    id: string;
    source: string;
    route: string;
    allowedHosts?: string[];
    keyValueStores?: string[];
  }[];
}): string {
  const { appName, version = "1.0.0", components } = config;

  let toml = `# Generated by @opennextjs/akamai
spin_manifest_version = 2

[application]
name = "${appName}"
version = "${version}"
authors = ["OpenNext Akamai"]
description = "Next.js application deployed with OpenNext on Fermyon Spin"

`;

  for (const component of components) {
    toml += `[[trigger.http]]
route = "${component.route}"
component = "${component.id}"

[component.${component.id}]
source = "${component.source}"
`;

    if (component.allowedHosts && component.allowedHosts.length > 0) {
      toml += `allowed_outbound_hosts = [\n`;
      for (const host of component.allowedHosts) {
        toml += `  "${host}",\n`;
      }
      toml += `]\n`;
    }

    if (component.keyValueStores && component.keyValueStores.length > 0) {
      toml += `key_value_stores = [\n`;
      for (const store of component.keyValueStores) {
        toml += `  "${store}",\n`;
      }
      toml += `]\n`;
    }

    toml += `\n`;
  }

  // Add key-value store configurations
  toml += `# Key-value stores for caching
[component.cache]
source = { url = "https://ghcr.io/fermyon/spin-key-value" }

[key_value_store.default]
type = "spin"
`;

  return toml;
}

/**
 * Generate TypeScript entry point for Spin component
 */
export function generateSpinEntryPoint(handlerPath: string): string {
  return `// Generated by @opennextjs/akamai
// Spin HTTP trigger entry point

import { handleHttpRequest } from "@fermyon/spin-sdk";
import { handler as nextHandler } from "${handlerPath}";
import { createSpinConverter } from "@opennextjs/akamai/wrappers/fermyon";

const converter = createSpinConverter();

export const handleRequest = handleHttpRequest(async (request) => {
  // Convert Spin request to internal format
  const internalEvent = converter.convertFrom(request);

  // Add body if present
  if (request.body) {
    const bodyBytes = await request.arrayBuffer();
    internalEvent.body = Buffer.from(bodyBytes);
  }

  // Call Next.js handler
  const result = await nextHandler(internalEvent);

  // Convert back to Spin response
  return converter.convertTo(result);
});
`;
}

// ============================================================================
// Spin Key-Value Cache Adapter
// ============================================================================

/**
 * Create a cache adapter using Spin's built-in key-value store
 */
export function createSpinKvCache() {
  // Spin KV is accessed through the SDK at runtime
  // @ts-expect-error - Spin SDK is only available in Spin runtime
  const kv: SpinKv = globalThis.spinKv;

  return {
    name: "spin-kv-cache",

    async get(key: string): Promise<Uint8Array | null> {
      try {
        return await kv.get(key);
      } catch {
        return null;
      }
    },

    async set(key: string, value: Uint8Array): Promise<void> {
      await kv.set(key, value);
    },

    async delete(key: string): Promise<void> {
      await kv.delete(key);
    },

    async exists(key: string): Promise<boolean> {
      return await kv.exists(key);
    },
  };
}

// ============================================================================
// Outbound HTTP for Revalidation
// ============================================================================

/**
 * Make outbound HTTP request from Spin component
 * Used for ISR revalidation
 */
export async function spinFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  } = {}
): Promise<SpinResponse> {
  // @ts-expect-error - Spin SDK is only available in Spin runtime
  const http: SpinOutboundHttp = globalThis.spinOutboundHttp;

  const parsedUrl = new URL(url);

  const request: SpinRequest = {
    method: options.method || "GET",
    uri: url,
    headers: Object.entries(options.headers || {}).map(([k, v]) => [k, v]),
  };

  if (options.body) {
    request.body =
      typeof options.body === "string"
        ? new TextEncoder().encode(options.body)
        : options.body;
  }

  return await http.send(request);
}

/**
 * Trigger ISR revalidation via HEAD request
 */
export async function triggerRevalidation(
  host: string,
  path: string
): Promise<boolean> {
  try {
    const url = `https://${host}${path}`;
    const response = await spinFetch(url, {
      method: "HEAD",
      headers: {
        "x-prerender-revalidate": "true",
      },
    });

    return response.status >= 200 && response.status < 400;
  } catch (error) {
    console.error(`[Spin] Revalidation failed for ${path}:`, error);
    return false;
  }
}
