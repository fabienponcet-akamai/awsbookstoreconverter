/**
 * Redis Streams Queue Handler for ISR Revalidation
 *
 * This handler uses Redis Streams (on Linode Managed Database) to queue
 * ISR revalidation requests. Redis Streams provide:
 * - Persistent, ordered message delivery
 * - Consumer groups for distributed processing
 * - At-least-once delivery guarantees
 *
 * Environment Variables:
 * - REDIS_URL: Redis connection URL (redis://...)
 * - REDIS_STREAM_NAME: Stream name (default: "opennext:revalidation")
 * - REDIS_CONSUMER_GROUP: Consumer group name (default: "revalidation-workers")
 */

import Redis from "ioredis";
import type { QueueHandler, RevalidationMessage } from "../types/index.js";

// Configuration
const DEFAULT_STREAM_NAME = "opennext:revalidation";
const DEFAULT_CONSUMER_GROUP = "revalidation-workers";
const DEFAULT_MAX_LEN = 10000; // Max messages in stream

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL environment variable is required");
  }
  return url;
}

function getStreamName(): string {
  return process.env.REDIS_STREAM_NAME || DEFAULT_STREAM_NAME;
}

function getConsumerGroup(): string {
  return process.env.REDIS_CONSUMER_GROUP || DEFAULT_CONSUMER_GROUP;
}

// Create Redis client with connection pooling
let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    const url = getRedisUrl();
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      retryDelayOnClusterDown: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redisClient.on("error", (error) => {
      console.error("[Redis Streams] Connection error:", error);
    });

    redisClient.on("connect", () => {
      console.debug("[Redis Streams] Connected");
    });
  }

  return redisClient;
}

// Initialize consumer group (call once at startup)
async function ensureConsumerGroup(): Promise<void> {
  const client = getRedisClient();
  const streamName = getStreamName();
  const groupName = getConsumerGroup();

  try {
    // Create consumer group if it doesn't exist
    // Use MKSTREAM to create the stream if it doesn't exist
    await client.xgroup("CREATE", streamName, groupName, "0", "MKSTREAM");
    console.debug(`[Redis Streams] Created consumer group: ${groupName}`);
  } catch (error: unknown) {
    // Group already exists - this is fine
    if (
      error instanceof Error &&
      error.message.includes("BUSYGROUP")
    ) {
      console.debug(`[Redis Streams] Consumer group already exists: ${groupName}`);
    } else {
      throw error;
    }
  }
}

// Queue handler for sending revalidation messages
export function createRedisStreamsQueue(): QueueHandler {
  const client = getRedisClient();
  const streamName = getStreamName();

  return {
    name: "redis-streams-queue",

    async send(message: RevalidationMessage): Promise<void> {
      try {
        // Add message to stream with auto-generated ID
        // Use MAXLEN ~ to trim stream to approximate max length
        const messageId = await client.xadd(
          streamName,
          "MAXLEN",
          "~",
          DEFAULT_MAX_LEN.toString(),
          "*", // Auto-generate ID
          "host",
          message.host,
          "url",
          message.url,
          "id",
          message.id,
          "timestamp",
          Date.now().toString()
        );

        console.debug(
          `[Redis Streams] Queued revalidation: ${message.url} (ID: ${messageId})`
        );
      } catch (error) {
        console.error("[Redis Streams] Failed to queue message:", error);
        throw error;
      }
    },
  };
}

// Default export for OpenNext override system
const redisStreamsQueue = createRedisStreamsQueue;
export default redisStreamsQueue;

// ============================================================================
// Consumer/Worker implementation for revalidation processing
// ============================================================================

export interface RevalidationWorkerOptions {
  /**
   * Consumer name (unique per worker instance)
   */
  consumerName: string;

  /**
   * Number of messages to fetch per batch
   * @default 10
   */
  batchSize?: number;

  /**
   * Block timeout in milliseconds
   * @default 5000
   */
  blockTimeout?: number;

  /**
   * Handler function for processing revalidation requests
   */
  handler: (message: RevalidationMessage) => Promise<void>;

  /**
   * Error handler
   */
  onError?: (error: Error, message: RevalidationMessage) => void;
}

/**
 * Start a revalidation worker that processes messages from the stream
 */
export async function startRevalidationWorker(
  options: RevalidationWorkerOptions
): Promise<{ stop: () => Promise<void> }> {
  const {
    consumerName,
    batchSize = 10,
    blockTimeout = 5000,
    handler,
    onError,
  } = options;

  const client = getRedisClient();
  const streamName = getStreamName();
  const groupName = getConsumerGroup();

  let running = true;

  // Ensure consumer group exists
  await ensureConsumerGroup();

  // Process messages in a loop
  const processLoop = async () => {
    while (running) {
      try {
        // Read messages from stream
        // Use XREADGROUP to read as part of consumer group
        const result = await client.xreadgroup(
          "GROUP",
          groupName,
          consumerName,
          "COUNT",
          batchSize.toString(),
          "BLOCK",
          blockTimeout.toString(),
          "STREAMS",
          streamName,
          ">" // Only new messages
        );

        if (!result || result.length === 0) {
          continue;
        }

        // Process each message
        for (const [, messages] of result) {
          for (const [messageId, fields] of messages) {
            // Parse message fields
            const message: RevalidationMessage = {
              host: "",
              url: "",
              id: "",
            };

            for (let i = 0; i < fields.length; i += 2) {
              const key = fields[i];
              const value = fields[i + 1];

              switch (key) {
                case "host":
                  message.host = value;
                  break;
                case "url":
                  message.url = value;
                  break;
                case "id":
                  message.id = value;
                  break;
              }
            }

            try {
              // Process the message
              await handler(message);

              // Acknowledge successful processing
              await client.xack(streamName, groupName, messageId);
              console.debug(
                `[Redis Streams] Processed and ACKed: ${message.url}`
              );
            } catch (error) {
              console.error(
                `[Redis Streams] Failed to process ${message.url}:`,
                error
              );

              if (onError && error instanceof Error) {
                onError(error, message);
              }

              // Don't ACK - message will be re-delivered
            }
          }
        }
      } catch (error) {
        console.error("[Redis Streams] Worker error:", error);
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  // Start processing
  const processPromise = processLoop();

  return {
    stop: async () => {
      running = false;
      await processPromise;
      console.debug("[Redis Streams] Worker stopped");
    },
  };
}

/**
 * Process pending (unacknowledged) messages from the stream
 * Call this at startup to handle any messages that were being processed
 * when a worker crashed
 */
export async function processPendingMessages(
  consumerName: string,
  handler: (message: RevalidationMessage) => Promise<void>
): Promise<number> {
  const client = getRedisClient();
  const streamName = getStreamName();
  const groupName = getConsumerGroup();

  let processed = 0;

  // Get pending messages for this consumer
  const pending = await client.xpending(
    streamName,
    groupName,
    "-",
    "+",
    "100",
    consumerName
  );

  if (!pending || pending.length === 0) {
    return 0;
  }

  for (const [messageId] of pending) {
    try {
      // Claim and read the message
      const claimed = await client.xclaim(
        streamName,
        groupName,
        consumerName,
        0, // Min idle time
        messageId
      );

      if (claimed && claimed.length > 0) {
        const [, fields] = claimed[0];

        const message: RevalidationMessage = {
          host: "",
          url: "",
          id: "",
        };

        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const value = fields[i + 1];

          switch (key) {
            case "host":
              message.host = value;
              break;
            case "url":
              message.url = value;
              break;
            case "id":
              message.id = value;
              break;
          }
        }

        await handler(message);
        await client.xack(streamName, groupName, messageId);
        processed++;
      }
    } catch (error) {
      console.error(`[Redis Streams] Failed to process pending ${messageId}:`, error);
    }
  }

  return processed;
}

// Cleanup function
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
