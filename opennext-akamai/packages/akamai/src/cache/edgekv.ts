/**
 * EdgeKV Incremental Cache Handler
 *
 * This handler uses Akamai EdgeKV for storing ISR/SSG cache entries.
 * EdgeKV provides ultra-low latency reads from the edge (< 10ms globally).
 *
 * Environment Variables:
 * - AKAMAI_EDGEKV_NAMESPACE: EdgeKV namespace ID
 * - AKAMAI_EDGEKV_GROUP: EdgeKV group name (default: "cache")
 * - AKAMAI_EDGEKV_ACCESS_TOKEN: EdgeKV access token
 * - AKAMAI_EDGEKV_ENV: Environment (production, staging)
 */

import type {
  IncrementalCacheHandler,
  CacheEntry,
  CacheValue,
} from "../types/index.js";

// EdgeKV client interface (matches Akamai's EdgeKV JavaScript API)
interface EdgeKVClient {
  getText(options: { item: string }): Promise<string | null>;
  putText(options: {
    item: string;
    value: string;
    expiry?: number;
  }): Promise<void>;
  delete(options: { item: string }): Promise<void>;
}

// EdgeKV factory for different environments
interface EdgeKVFactory {
  createClient(
    namespace: string,
    group: string,
    options?: { staging?: boolean }
  ): EdgeKVClient;
}

// Fallback HTTP client for non-EdgeWorker environments
class EdgeKVHttpClient implements EdgeKVClient {
  private baseUrl: string;
  private accessToken: string;
  private namespace: string;
  private group: string;

  constructor(
    namespace: string,
    group: string,
    accessToken: string,
    environment: string = "production"
  ) {
    this.namespace = namespace;
    this.group = group;
    this.accessToken = accessToken;
    this.baseUrl =
      environment === "staging"
        ? "https://edgekv-staging.akamai.com"
        : "https://edgekv.akamai.com";
  }

  private getUrl(item: string): string {
    return `${this.baseUrl}/api/v1/namespaces/${this.namespace}/groups/${this.group}/items/${encodeURIComponent(item)}`;
  }

  async getText(options: { item: string }): Promise<string | null> {
    try {
      const response = await fetch(this.getUrl(options.item), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`EdgeKV GET failed: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      console.error("[EdgeKV] Get error:", error);
      return null;
    }
  }

  async putText(options: {
    item: string;
    value: string;
    expiry?: number;
  }): Promise<void> {
    const url = new URL(this.getUrl(options.item));
    if (options.expiry) {
      url.searchParams.set("expiry", options.expiry.toString());
    }

    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: options.value,
    });

    if (!response.ok) {
      throw new Error(`EdgeKV PUT failed: ${response.status}`);
    }
  }

  async delete(options: { item: string }): Promise<void> {
    const response = await fetch(this.getUrl(options.item), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`EdgeKV DELETE failed: ${response.status}`);
    }
  }
}

// Cache key helpers
function getCacheKey(key: string): string {
  // EdgeKV has a 512 character limit for keys
  // Use a hash for long keys
  if (key.length > 400) {
    return `hashed:${hashKey(key)}`;
  }
  // Replace problematic characters
  return key.replace(/[/\\:*?"<>|]/g, "_");
}

function hashKey(key: string): string {
  // Simple hash function for key normalization
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Serialize cache entry for storage
function serializeCacheEntry(entry: CacheEntry): string {
  const serialized = {
    ...entry,
    value: {
      ...entry.value,
      // Convert Buffer to base64 for JSON serialization
      body: entry.value.body
        ? Buffer.from(entry.value.body).toString("base64")
        : undefined,
    },
  };
  return JSON.stringify(serialized);
}

// Deserialize cache entry from storage
function deserializeCacheEntry(data: string): CacheEntry {
  const parsed = JSON.parse(data);
  return {
    ...parsed,
    value: {
      ...parsed.value,
      // Convert base64 back to Buffer
      body: parsed.value.body
        ? Buffer.from(parsed.value.body, "base64")
        : undefined,
    },
  };
}

// Calculate TTL in seconds
function calculateTtl(entry: CacheEntry): number {
  if (entry.revalidate) {
    // Add some buffer for stale-while-revalidate
    return entry.revalidate + 3600; // revalidate + 1 hour buffer
  }
  // Default TTL: 24 hours
  return 86400;
}

// EdgeKV cache handler factory
export function createEdgeKVCache(): IncrementalCacheHandler {
  // Get configuration from environment
  const namespace = process.env.AKAMAI_EDGEKV_NAMESPACE;
  const group = process.env.AKAMAI_EDGEKV_GROUP || "cache";
  const accessToken = process.env.AKAMAI_EDGEKV_ACCESS_TOKEN;
  const environment = process.env.AKAMAI_EDGEKV_ENV || "production";

  if (!namespace) {
    throw new Error("AKAMAI_EDGEKV_NAMESPACE environment variable is required");
  }

  // Check if running in EdgeWorkers environment
  let client: EdgeKVClient;

  // @ts-expect-error - EdgeKV global is only available in EdgeWorkers runtime
  if (typeof EdgeKV !== "undefined") {
    // Running in EdgeWorkers - use native EdgeKV
    // @ts-expect-error - EdgeKV global is only available in EdgeWorkers runtime
    const edgekvFactory = EdgeKV as EdgeKVFactory;
    client = edgekvFactory.createClient(namespace, group, {
      staging: environment === "staging",
    });
  } else {
    // Running outside EdgeWorkers - use HTTP client
    if (!accessToken) {
      throw new Error(
        "AKAMAI_EDGEKV_ACCESS_TOKEN is required when running outside EdgeWorkers"
      );
    }
    client = new EdgeKVHttpClient(namespace, group, accessToken, environment);
  }

  return {
    name: "edgekv-incremental-cache",

    async get(key: string): Promise<CacheEntry | null> {
      const cacheKey = getCacheKey(key);

      try {
        const data = await client.getText({ item: cacheKey });

        if (!data) {
          console.debug(`[EdgeKV Cache] MISS: ${key}`);
          return null;
        }

        const entry = deserializeCacheEntry(data);

        // Check if entry is stale
        const now = Date.now();
        const age = (now - entry.lastModified) / 1000;
        const isStale = entry.revalidate ? age > entry.revalidate : false;

        if (isStale) {
          console.debug(`[EdgeKV Cache] STALE: ${key} (age: ${age}s)`);
          // Return stale entry - caller should trigger revalidation
        } else {
          console.debug(`[EdgeKV Cache] HIT: ${key}`);
        }

        return entry;
      } catch (error) {
        console.error(`[EdgeKV Cache] Error getting ${key}:`, error);
        return null;
      }
    },

    async set(key: string, value: CacheEntry): Promise<void> {
      const cacheKey = getCacheKey(key);
      const ttl = calculateTtl(value);

      try {
        const serialized = serializeCacheEntry(value);

        // Check size limit (EdgeKV has 1MB limit per item)
        const sizeBytes = Buffer.byteLength(serialized, "utf8");
        if (sizeBytes > 1024 * 1024) {
          console.warn(
            `[EdgeKV Cache] Entry too large (${sizeBytes} bytes), skipping: ${key}`
          );
          return;
        }

        await client.putText({
          item: cacheKey,
          value: serialized,
          expiry: ttl,
        });

        console.debug(`[EdgeKV Cache] SET: ${key} (TTL: ${ttl}s)`);
      } catch (error) {
        console.error(`[EdgeKV Cache] Error setting ${key}:`, error);
        throw error;
      }
    },

    async delete(key: string): Promise<void> {
      const cacheKey = getCacheKey(key);

      try {
        await client.delete({ item: cacheKey });
        console.debug(`[EdgeKV Cache] DELETE: ${key}`);
      } catch (error) {
        console.error(`[EdgeKV Cache] Error deleting ${key}:`, error);
        // Don't throw on delete errors
      }
    },
  };
}

// Default export for OpenNext override system
const edgeKVIncrementalCache = createEdgeKVCache;
export default edgeKVIncrementalCache;

// Tag cache implementation using EdgeKV
export function createEdgeKVTagCache() {
  const namespace = process.env.AKAMAI_EDGEKV_NAMESPACE;
  const group = process.env.AKAMAI_EDGEKV_TAG_GROUP || "tags";
  const accessToken = process.env.AKAMAI_EDGEKV_ACCESS_TOKEN;
  const environment = process.env.AKAMAI_EDGEKV_ENV || "production";

  if (!namespace) {
    throw new Error("AKAMAI_EDGEKV_NAMESPACE environment variable is required");
  }

  let client: EdgeKVClient;

  // @ts-expect-error - EdgeKV global is only available in EdgeWorkers runtime
  if (typeof EdgeKV !== "undefined") {
    // @ts-expect-error - EdgeKV global is only available in EdgeWorkers runtime
    const edgekvFactory = EdgeKV as EdgeKVFactory;
    client = edgekvFactory.createClient(namespace, group, {
      staging: environment === "staging",
    });
  } else {
    if (!accessToken) {
      throw new Error(
        "AKAMAI_EDGEKV_ACCESS_TOKEN is required when running outside EdgeWorkers"
      );
    }
    client = new EdgeKVHttpClient(namespace, group, accessToken, environment);
  }

  return {
    name: "edgekv-tag-cache",

    async getByTag(tag: string): Promise<string[]> {
      const key = `tag:${getCacheKey(tag)}`;
      const data = await client.getText({ item: key });
      if (!data) return [];
      return JSON.parse(data);
    },

    async getByPath(path: string): Promise<string[]> {
      const key = `path:${getCacheKey(path)}`;
      const data = await client.getText({ item: key });
      if (!data) return [];
      return JSON.parse(data);
    },

    async getLastModified(
      key: string,
      lastModified?: number
    ): Promise<number> {
      const itemKey = `lastmod:${getCacheKey(key)}`;
      const data = await client.getText({ item: itemKey });
      if (!data) return lastModified || Date.now();
      return parseInt(data, 10);
    },

    async writeTags(
      tags: { tag: string; path: string; revalidatedAt?: number }[]
    ): Promise<void> {
      // Group by tag
      const tagMap = new Map<string, string[]>();
      const pathMap = new Map<string, string[]>();

      for (const { tag, path } of tags) {
        // Update tag -> paths mapping
        if (!tagMap.has(tag)) {
          const existing = await this.getByTag(tag);
          tagMap.set(tag, existing);
        }
        const paths = tagMap.get(tag)!;
        if (!paths.includes(path)) {
          paths.push(path);
        }

        // Update path -> tags mapping
        if (!pathMap.has(path)) {
          const existing = await this.getByPath(path);
          pathMap.set(path, existing);
        }
        const existingTags = pathMap.get(path)!;
        if (!existingTags.includes(tag)) {
          existingTags.push(tag);
        }
      }

      // Write all updates
      const writes: Promise<void>[] = [];

      for (const [tag, paths] of tagMap) {
        const key = `tag:${getCacheKey(tag)}`;
        writes.push(
          client.putText({
            item: key,
            value: JSON.stringify(paths),
            expiry: 86400 * 7, // 7 days
          })
        );
      }

      for (const [path, pathTags] of pathMap) {
        const key = `path:${getCacheKey(path)}`;
        writes.push(
          client.putText({
            item: key,
            value: JSON.stringify(pathTags),
            expiry: 86400 * 7, // 7 days
          })
        );
      }

      await Promise.all(writes);
    },
  };
}
