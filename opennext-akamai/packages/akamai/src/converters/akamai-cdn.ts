/**
 * Akamai CDN Converter
 *
 * This converter handles request/response transformation for requests
 * coming through the Akamai CDN. It handles:
 * - Akamai-specific headers (True-Client-IP, X-Akamai-*, etc.)
 * - Edge request metadata
 * - Cache control headers for CDN integration
 * - Geo-location and device detection headers
 */

import type {
  Converter,
  InternalEvent,
  InternalResult,
} from "../types/index.js";

// ============================================================================
// Akamai-specific Headers
// ============================================================================

/**
 * Headers added by Akamai CDN
 */
interface AkamaiHeaders {
  // Client identification
  "true-client-ip"?: string;
  "x-forwarded-for"?: string;

  // Geo-location (Akamai EdgeScape)
  "x-akamai-edgescape"?: string;

  // Device detection
  "x-akamai-device-characteristics"?: string;

  // Cache status
  "x-cache"?: string;
  "x-cache-key"?: string;
  "x-cache-remote"?: string;

  // Request metadata
  "x-akamai-request-id"?: string;
  "x-akamai-transformed"?: string;

  // Bot detection
  "x-akamai-bot-detection"?: string;
}

/**
 * Parse Akamai EdgeScape geo header
 */
function parseEdgeScape(header: string): Record<string, string> {
  const result: Record<string, string> = {};

  // EdgeScape format: key=value,key=value,...
  if (header) {
    const parts = header.split(",");
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key && value) {
        result[key.trim()] = value.trim();
      }
    }
  }

  return result;
}

/**
 * Parse Akamai device characteristics header
 */
function parseDeviceCharacteristics(header: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Format: key=value;key=value;...
  if (header) {
    const parts = header.split(";");
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key && value) {
        result[key.trim()] = value.trim();
      }
    }
  }

  return result;
}

// ============================================================================
// Converter Implementation
// ============================================================================

export function createAkamaiCdnConverter(): Converter {
  return {
    name: "akamai-cdn-converter",

    convertFrom(event: unknown): InternalEvent {
      // Handle both raw HTTP request and pre-parsed objects
      const request = event as {
        method: string;
        url: string;
        path?: string;
        headers: Record<string, string | string[]> | Headers;
        body?: string | Buffer | ArrayBuffer;
        query?: Record<string, string | string[]>;
      };

      // Normalize headers to Record<string, string>
      const headers: Record<string, string> = {};
      if (request.headers instanceof Headers) {
        request.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
      } else {
        for (const [key, value] of Object.entries(request.headers)) {
          headers[key.toLowerCase()] = Array.isArray(value)
            ? value.join(", ")
            : value;
        }
      }

      // Parse URL
      const url = new URL(request.url, "https://localhost");
      const rawPath = request.path || url.pathname;

      // Parse query parameters
      const query: Record<string, string | string[]> = request.query || {};
      if (!request.query) {
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
      }

      // Parse cookies
      const cookies: Record<string, string> = {};
      const cookieHeader = headers["cookie"];
      if (cookieHeader) {
        cookieHeader.split(";").forEach((cookie) => {
          const [name, ...valueParts] = cookie.trim().split("=");
          const value = valueParts.join("=");
          if (name && value) {
            try {
              cookies[name] = decodeURIComponent(value);
            } catch {
              cookies[name] = value;
            }
          }
        });
      }

      // Get client IP from Akamai headers
      const remoteAddress =
        headers["true-client-ip"] ||
        headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        undefined;

      // Parse Akamai EdgeScape geo data
      const edgeScape = parseEdgeScape(headers["x-akamai-edgescape"] || "");

      // Add Next.js-compatible geo headers
      if (edgeScape.country_code) {
        headers["x-vercel-ip-country"] = edgeScape.country_code;
      }
      if (edgeScape.region_code) {
        headers["x-vercel-ip-country-region"] = edgeScape.region_code;
      }
      if (edgeScape.city) {
        headers["x-vercel-ip-city"] = edgeScape.city;
      }
      if (edgeScape.lat) {
        headers["x-vercel-ip-latitude"] = edgeScape.lat;
      }
      if (edgeScape.long) {
        headers["x-vercel-ip-longitude"] = edgeScape.long;
      }
      if (edgeScape.timezone) {
        headers["x-vercel-ip-timezone"] = edgeScape.timezone;
      }

      // Parse device characteristics
      const deviceChars = parseDeviceCharacteristics(
        headers["x-akamai-device-characteristics"] || ""
      );

      if (deviceChars.is_mobile === "true") {
        headers["x-device-type"] = "mobile";
      } else if (deviceChars.is_tablet === "true") {
        headers["x-device-type"] = "tablet";
      } else {
        headers["x-device-type"] = "desktop";
      }

      // Build internal event
      const internalEvent: InternalEvent = {
        type: "v2",
        method: request.method,
        rawPath,
        url: request.url,
        headers,
        query,
        cookies,
        remoteAddress,
      };

      // Add body if present
      if (request.body) {
        if (typeof request.body === "string") {
          internalEvent.body = Buffer.from(request.body);
        } else if (request.body instanceof ArrayBuffer) {
          internalEvent.body = Buffer.from(request.body);
        } else {
          internalEvent.body = request.body;
        }
      }

      return internalEvent;
    },

    convertTo(result: InternalResult): unknown {
      // Build response headers
      const headers: Record<string, string | string[]> = {};

      for (const [key, value] of Object.entries(result.headers)) {
        // Skip internal headers
        if (key.startsWith("x-opennext-")) continue;

        headers[key] = value;
      }

      // Add Akamai-specific cache control
      const cacheControl = result.headers["cache-control"];
      if (cacheControl) {
        // Parse and enhance cache-control for Akamai
        headers["cache-control"] = enhanceCacheControl(
          Array.isArray(cacheControl) ? cacheControl[0] : cacheControl
        );
      }

      // Add Edge-Cache-Tag header for cache purging
      const tags = result.headers["x-next-cache-tags"];
      if (tags) {
        // Akamai uses Edge-Cache-Tag for cache tagging
        headers["edge-cache-tag"] = Array.isArray(tags)
          ? tags.join(",")
          : tags;
      }

      // Add Surrogate-Control for Akamai CDN
      const surrogateControl = result.headers["x-opennext-surrogate-control"];
      if (surrogateControl) {
        headers["surrogate-control"] = surrogateControl;
      }

      // Decode body if base64 encoded
      let body: string | Buffer = result.body;
      if (result.isBase64Encoded) {
        body = Buffer.from(result.body, "base64");
      }

      return {
        statusCode: result.statusCode,
        headers,
        body: typeof body === "string" ? body : body.toString("base64"),
        isBase64Encoded: result.isBase64Encoded,
      };
    },
  };
}

/**
 * Enhance cache-control header for Akamai CDN
 */
function enhanceCacheControl(cacheControl: string): string {
  const directives = cacheControl
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const parsed: Record<string, string | boolean> = {};

  for (const directive of directives) {
    const [key, value] = directive.split("=");
    parsed[key.toLowerCase()] = value || true;
  }

  // Akamai respects s-maxage for edge caching
  // If stale-while-revalidate is set, ensure it's respected
  const result: string[] = [];

  if (parsed["private"]) {
    result.push("private");
  } else if (parsed["public"]) {
    result.push("public");
  }

  if (parsed["no-cache"]) {
    result.push("no-cache");
  }

  if (parsed["no-store"]) {
    result.push("no-store");
  }

  if (parsed["s-maxage"]) {
    result.push(`s-maxage=${parsed["s-maxage"]}`);
  } else if (parsed["max-age"]) {
    // Use max-age as s-maxage if not set
    result.push(`s-maxage=${parsed["max-age"]}`);
  }

  if (parsed["max-age"]) {
    result.push(`max-age=${parsed["max-age"]}`);
  }

  if (parsed["stale-while-revalidate"]) {
    result.push(`stale-while-revalidate=${parsed["stale-while-revalidate"]}`);
  }

  if (parsed["stale-if-error"]) {
    result.push(`stale-if-error=${parsed["stale-if-error"]}`);
  }

  if (parsed["must-revalidate"]) {
    result.push("must-revalidate");
  }

  return result.join(", ");
}

// Default export for OpenNext override system
const akamaiCdnConverter = createAkamaiCdnConverter;
export default akamaiCdnConverter;

// ============================================================================
// Property Manager Rule Generator
// ============================================================================

export interface PropertyManagerRule {
  name: string;
  criteria: PropertyCriteria[];
  behaviors: PropertyBehavior[];
  children?: PropertyManagerRule[];
}

export interface PropertyCriteria {
  name: string;
  options: Record<string, unknown>;
}

export interface PropertyBehavior {
  name: string;
  options: Record<string, unknown>;
}

/**
 * Generate Property Manager rules for Next.js application
 */
export function generatePropertyManagerRules(config: {
  originHostname: string;
  staticOrigin?: string;
  cpCode: number;
}): PropertyManagerRule {
  return {
    name: "Next.js Application",
    criteria: [],
    behaviors: [
      {
        name: "origin",
        options: {
          originType: "CUSTOMER",
          hostname: config.originHostname,
          forwardHostHeader: "REQUEST_HOST_HEADER",
          cacheKeyHostname: "REQUEST_HOST_HEADER",
          compress: true,
          enableTrueClientIp: true,
          trueClientIpHeader: "True-Client-IP",
          trueClientIpClientSetting: false,
        },
      },
      {
        name: "cpCode",
        options: {
          value: { id: config.cpCode },
        },
      },
    ],
    children: [
      // Static assets rule
      {
        name: "Static Assets",
        criteria: [
          {
            name: "path",
            options: {
              matchOperator: "MATCHES_ONE_OF",
              values: ["/_next/static/*", "/static/*", "/*.ico", "/*.txt"],
              matchCaseSensitive: false,
            },
          },
        ],
        behaviors: [
          {
            name: "caching",
            options: {
              behavior: "MAX_AGE",
              ttl: "365d",
              mustRevalidate: false,
            },
          },
          {
            name: "prefetch",
            options: { enabled: true },
          },
        ],
      },
      // Image optimization rule
      {
        name: "Image Optimization",
        criteria: [
          {
            name: "path",
            options: {
              matchOperator: "MATCHES_ONE_OF",
              values: ["/_next/image*"],
              matchCaseSensitive: false,
            },
          },
        ],
        behaviors: [
          {
            name: "imageManager",
            options: {
              enabled: true,
              resize: true,
              applyBestFileType: true,
              superCacheRegion: "US",
            },
          },
          {
            name: "caching",
            options: {
              behavior: "MAX_AGE",
              ttl: "30d",
            },
          },
        ],
      },
      // API routes rule
      {
        name: "API Routes",
        criteria: [
          {
            name: "path",
            options: {
              matchOperator: "MATCHES_ONE_OF",
              values: ["/api/*"],
              matchCaseSensitive: false,
            },
          },
        ],
        behaviors: [
          {
            name: "caching",
            options: {
              behavior: "NO_STORE",
            },
          },
          {
            name: "allowPost",
            options: {
              enabled: true,
              allowWithoutContentLength: true,
            },
          },
        ],
      },
      // Dynamic pages rule
      {
        name: "Dynamic Pages",
        criteria: [
          {
            name: "path",
            options: {
              matchOperator: "DOES_NOT_MATCH_ONE_OF",
              values: ["/_next/*", "/api/*", "/static/*"],
              matchCaseSensitive: false,
            },
          },
        ],
        behaviors: [
          {
            name: "caching",
            options: {
              behavior: "CACHE_CONTROL",
              honorOriginCacheControl: true,
              defaultTtl: "0s",
            },
          },
          {
            name: "downstreamCache",
            options: {
              behavior: "PASS_ORIGIN",
            },
          },
        ],
      },
    ],
  };
}

/**
 * Convert Property Manager rules to JSON format
 */
export function rulesToJson(rules: PropertyManagerRule): string {
  return JSON.stringify(rules, null, 2);
}
