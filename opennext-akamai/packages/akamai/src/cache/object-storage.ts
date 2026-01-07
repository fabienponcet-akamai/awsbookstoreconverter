/**
 * Linode Object Storage Incremental Cache Handler
 *
 * This handler uses Linode Object Storage (S3-compatible) for storing
 * ISR/SSG cache entries. It provides durable storage with good latency
 * from Linode regions.
 *
 * Environment Variables:
 * - LINODE_OBJECT_STORAGE_ENDPOINT: S3 endpoint (e.g., us-east-1.linodeobjects.com)
 * - LINODE_OBJECT_STORAGE_BUCKET: Bucket name
 * - LINODE_OBJECT_STORAGE_ACCESS_KEY: Access key
 * - LINODE_OBJECT_STORAGE_SECRET_KEY: Secret key
 * - LINODE_OBJECT_STORAGE_REGION: Region (default: us-east-1)
 * - CACHE_KEY_PREFIX: Prefix for cache keys (default: "cache/")
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  IncrementalCacheHandler,
  CacheEntry,
} from "../types/index.js";

// Initialize S3 client for Linode Object Storage
function createS3Client(): S3Client {
  const endpoint = process.env.LINODE_OBJECT_STORAGE_ENDPOINT;
  const accessKeyId = process.env.LINODE_OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.LINODE_OBJECT_STORAGE_SECRET_KEY;
  const region = process.env.LINODE_OBJECT_STORAGE_REGION || "us-east-1";

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Linode Object Storage credentials not configured. " +
        "Set LINODE_OBJECT_STORAGE_ENDPOINT, LINODE_OBJECT_STORAGE_ACCESS_KEY, " +
        "and LINODE_OBJECT_STORAGE_SECRET_KEY environment variables."
    );
  }

  return new S3Client({
    endpoint: `https://${endpoint}`,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true, // Required for Linode Object Storage
  });
}

// Get bucket name from environment
function getBucket(): string {
  const bucket = process.env.LINODE_OBJECT_STORAGE_BUCKET;
  if (!bucket) {
    throw new Error(
      "LINODE_OBJECT_STORAGE_BUCKET environment variable is required"
    );
  }
  return bucket;
}

// Get cache key prefix
function getKeyPrefix(): string {
  return process.env.CACHE_KEY_PREFIX || "cache/";
}

// Build S3 key from cache key
function buildS3Key(key: string): string {
  const prefix = getKeyPrefix();
  // Normalize key - remove leading slash and replace problematic chars
  const normalizedKey = key.replace(/^\//, "").replace(/[?#]/g, "_");
  return `${prefix}${normalizedKey}`;
}

// Parse cache metadata from S3 object
interface CacheMetadata {
  lastModified: number;
  revalidate?: number;
  tags?: string[];
  kind: string;
}

function parseMetadata(metadata: Record<string, string>): CacheMetadata {
  return {
    lastModified: parseInt(metadata["x-cache-last-modified"] || "0", 10),
    revalidate: metadata["x-cache-revalidate"]
      ? parseInt(metadata["x-cache-revalidate"], 10)
      : undefined,
    tags: metadata["x-cache-tags"]
      ? metadata["x-cache-tags"].split(",")
      : undefined,
    kind: metadata["x-cache-kind"] || "PAGE",
  };
}

// Build metadata for S3 object
function buildMetadata(entry: CacheEntry): Record<string, string> {
  const metadata: Record<string, string> = {
    "x-cache-last-modified": entry.lastModified.toString(),
    "x-cache-kind": entry.value.kind,
  };

  if (entry.revalidate) {
    metadata["x-cache-revalidate"] = entry.revalidate.toString();
  }

  if (entry.tags && entry.tags.length > 0) {
    metadata["x-cache-tags"] = entry.tags.join(",");
  }

  return metadata;
}

// Serialize cache value for storage
function serializeValue(entry: CacheEntry): Buffer {
  const serialized = {
    ...entry.value,
    // Convert Buffer to base64
    body: entry.value.body
      ? Buffer.from(entry.value.body).toString("base64")
      : undefined,
  };
  return Buffer.from(JSON.stringify(serialized), "utf-8");
}

// Deserialize cache value from storage
function deserializeValue(data: Buffer, metadata: CacheMetadata): CacheEntry {
  const parsed = JSON.parse(data.toString("utf-8"));
  return {
    value: {
      ...parsed,
      body: parsed.body ? Buffer.from(parsed.body, "base64") : undefined,
    },
    lastModified: metadata.lastModified,
    revalidate: metadata.revalidate,
    tags: metadata.tags,
  };
}

// Object Storage cache handler factory
export function createObjectStorageCache(): IncrementalCacheHandler {
  const client = createS3Client();
  const bucket = getBucket();

  return {
    name: "linode-object-storage-cache",

    async get(key: string): Promise<CacheEntry | null> {
      const s3Key = buildS3Key(key);

      try {
        // Get object from S3
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: s3Key,
          })
        );

        if (!response.Body) {
          console.debug(`[Object Storage] MISS: ${key}`);
          return null;
        }

        // Read body
        const bodyBytes = await response.Body.transformToByteArray();
        const body = Buffer.from(bodyBytes);

        // Parse metadata
        const metadata = parseMetadata(response.Metadata || {});

        // Deserialize entry
        const entry = deserializeValue(body, metadata);

        // Check staleness
        const now = Date.now();
        const age = (now - entry.lastModified) / 1000;
        const isStale = entry.revalidate ? age > entry.revalidate : false;

        if (isStale) {
          console.debug(`[Object Storage] STALE: ${key} (age: ${age}s)`);
        } else {
          console.debug(`[Object Storage] HIT: ${key}`);
        }

        return entry;
      } catch (error: unknown) {
        // Handle not found
        if (
          error instanceof Error &&
          "name" in error &&
          error.name === "NoSuchKey"
        ) {
          console.debug(`[Object Storage] MISS: ${key}`);
          return null;
        }

        console.error(`[Object Storage] Error getting ${key}:`, error);
        return null;
      }
    },

    async set(key: string, value: CacheEntry): Promise<void> {
      const s3Key = buildS3Key(key);

      try {
        const body = serializeValue(value);
        const metadata = buildMetadata(value);

        // Determine content type
        let contentType = "application/json";
        if (value.value.kind === "IMAGE") {
          contentType = value.value.headers?.["content-type"] || "image/webp";
        }

        // Calculate cache control for CDN
        const maxAge = value.revalidate || 86400;
        const staleWhileRevalidate = Math.max(maxAge, 3600);
        const cacheControl = `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;

        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: body,
            ContentType: contentType,
            CacheControl: cacheControl,
            Metadata: metadata,
          })
        );

        console.debug(`[Object Storage] SET: ${key}`);
      } catch (error) {
        console.error(`[Object Storage] Error setting ${key}:`, error);
        throw error;
      }
    },

    async delete(key: string): Promise<void> {
      const s3Key = buildS3Key(key);

      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: s3Key,
          })
        );

        console.debug(`[Object Storage] DELETE: ${key}`);
      } catch (error) {
        console.error(`[Object Storage] Error deleting ${key}:`, error);
        // Don't throw on delete errors
      }
    },
  };
}

// Default export for OpenNext override system
const objectStorageIncrementalCache = createObjectStorageCache;
export default objectStorageIncrementalCache;

// Utility to check if an object exists
export async function objectExists(key: string): Promise<boolean> {
  const client = createS3Client();
  const bucket = getBucket();
  const s3Key = buildS3Key(key);

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

// Utility to get object metadata without body
export async function getObjectMetadata(
  key: string
): Promise<CacheMetadata | null> {
  const client = createS3Client();
  const bucket = getBucket();
  const s3Key = buildS3Key(key);

  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      })
    );

    return parseMetadata(response.Metadata || {});
  } catch {
    return null;
  }
}
