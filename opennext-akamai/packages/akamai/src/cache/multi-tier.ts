/**
 * Multi-Tier Incremental Cache Handler
 *
 * This handler combines EdgeKV (L1) and Linode Object Storage (L2) for
 * optimal performance and durability:
 *
 * - EdgeKV: Fast reads from edge, limited size (1MB/item), shorter TTL
 * - Object Storage: Durable storage, larger objects, source of truth
 *
 * Read flow:
 * 1. Check EdgeKV (L1) → if HIT, return
 * 2. Check Object Storage (L2) → if HIT, populate L1, return
 * 3. MISS
 *
 * Write flow:
 * 1. Write to Object Storage (L2) - source of truth
 * 2. Write to EdgeKV (L1) if size allows
 *
 * Environment Variables:
 * - All EdgeKV variables (AKAMAI_EDGEKV_*)
 * - All Object Storage variables (LINODE_OBJECT_STORAGE_*)
 * - MULTI_TIER_L1_MAX_SIZE: Max size for L1 cache (default: 512KB)
 * - MULTI_TIER_L1_TTL: L1 TTL in seconds (default: 300)
 */

import type {
  IncrementalCacheHandler,
  CacheEntry,
} from "../types/index.js";
import { createEdgeKVCache } from "./edgekv.js";
import { createObjectStorageCache } from "./object-storage.js";

// Configuration
const DEFAULT_L1_MAX_SIZE = 512 * 1024; // 512KB
const DEFAULT_L1_TTL = 300; // 5 minutes

function getL1MaxSize(): number {
  const envValue = process.env.MULTI_TIER_L1_MAX_SIZE;
  return envValue ? parseInt(envValue, 10) : DEFAULT_L1_MAX_SIZE;
}

function getL1Ttl(): number {
  const envValue = process.env.MULTI_TIER_L1_TTL;
  return envValue ? parseInt(envValue, 10) : DEFAULT_L1_TTL;
}

// Estimate serialized size of cache entry
function estimateSize(entry: CacheEntry): number {
  let size = 0;

  // JSON overhead
  size += 200;

  // HTML content
  if (entry.value.html) {
    size += entry.value.html.length;
  }

  // Body (binary)
  if (entry.value.body) {
    // Base64 encoding increases size by ~33%
    size += Math.ceil(entry.value.body.length * 1.33);
  }

  // JSON data
  if (entry.value.json) {
    size += JSON.stringify(entry.value.json).length;
  }

  return size;
}

// Check if entry should be cached in L1
function shouldCacheInL1(entry: CacheEntry): boolean {
  const maxSize = getL1MaxSize();
  const estimatedSize = estimateSize(entry);

  if (estimatedSize > maxSize) {
    console.debug(
      `[Multi-Tier] Entry too large for L1 (${estimatedSize} bytes > ${maxSize})`
    );
    return false;
  }

  return true;
}

// Adjust entry TTL for L1 cache
function adjustForL1(entry: CacheEntry): CacheEntry {
  const l1Ttl = getL1Ttl();

  return {
    ...entry,
    // Use shorter TTL for L1
    revalidate: Math.min(entry.revalidate || l1Ttl, l1Ttl),
  };
}

// Multi-tier cache handler factory
export function createMultiTierCache(): IncrementalCacheHandler {
  // Initialize both cache layers
  let l1Cache: IncrementalCacheHandler;
  let l2Cache: IncrementalCacheHandler;

  try {
    l1Cache = createEdgeKVCache();
  } catch (error) {
    console.warn("[Multi-Tier] EdgeKV (L1) not available:", error);
    // Create dummy L1 that always misses
    l1Cache = {
      name: "dummy-l1",
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    };
  }

  try {
    l2Cache = createObjectStorageCache();
  } catch (error) {
    console.error("[Multi-Tier] Object Storage (L2) not available:", error);
    throw new Error("L2 cache (Object Storage) is required for multi-tier cache");
  }

  return {
    name: "multi-tier-cache",

    async get(key: string): Promise<CacheEntry | null> {
      // Try L1 first (EdgeKV)
      const l1Result = await l1Cache.get(key);

      if (l1Result) {
        console.debug(`[Multi-Tier] L1 HIT: ${key}`);
        return l1Result;
      }

      console.debug(`[Multi-Tier] L1 MISS: ${key}, trying L2`);

      // Try L2 (Object Storage)
      const l2Result = await l2Cache.get(key);

      if (l2Result) {
        console.debug(`[Multi-Tier] L2 HIT: ${key}`);

        // Populate L1 cache asynchronously (don't wait)
        if (shouldCacheInL1(l2Result)) {
          const l1Entry = adjustForL1(l2Result);
          l1Cache.set(key, l1Entry).catch((error) => {
            console.warn(`[Multi-Tier] Failed to populate L1: ${error}`);
          });
        }

        return l2Result;
      }

      console.debug(`[Multi-Tier] L2 MISS: ${key}`);
      return null;
    },

    async set(key: string, value: CacheEntry): Promise<void> {
      // Always write to L2 first (source of truth)
      await l2Cache.set(key, value);
      console.debug(`[Multi-Tier] L2 SET: ${key}`);

      // Write to L1 if size allows
      if (shouldCacheInL1(value)) {
        const l1Entry = adjustForL1(value);
        try {
          await l1Cache.set(key, l1Entry);
          console.debug(`[Multi-Tier] L1 SET: ${key}`);
        } catch (error) {
          // L1 write failure is not critical
          console.warn(`[Multi-Tier] L1 SET failed: ${error}`);
        }
      }
    },

    async delete(key: string): Promise<void> {
      // Delete from both caches in parallel
      await Promise.all([
        l1Cache.delete(key).catch((error) => {
          console.warn(`[Multi-Tier] L1 DELETE failed: ${error}`);
        }),
        l2Cache.delete(key).catch((error) => {
          console.warn(`[Multi-Tier] L2 DELETE failed: ${error}`);
        }),
      ]);

      console.debug(`[Multi-Tier] DELETE: ${key}`);
    },
  };
}

// Default export for OpenNext override system
const multiTierIncrementalCache = createMultiTierCache;
export default multiTierIncrementalCache;

// Export individual layers for testing/customization
export { createEdgeKVCache, createObjectStorageCache };
