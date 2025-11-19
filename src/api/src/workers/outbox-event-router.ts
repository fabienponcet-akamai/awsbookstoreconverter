import { Pool } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('OutboxEventRouter');

// Connection pool for managed DBaaS (source of events)
const managedDbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ============================================================================
// Interfaces
// ============================================================================

export interface OutboxEvent {
  id: bigint;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: any;
  created_at: Date;
  retry_count: number;
}

export interface IEventHandler {
  name: string;
  supportedEvents: string[];
  handle(event: OutboxEvent): Promise<void>;
}

// ============================================================================
// Event Router
// ============================================================================

export class OutboxEventRouter {
  private handlers: Map<string, IEventHandler[]> = new Map();
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;

  private readonly BATCH_SIZE = 100;
  private readonly POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '1000'); // 1 second default
  private readonly MAX_RETRIES = 5;

  /**
   * Register a handler for specific event types
   */
  registerHandler(handler: IEventHandler): void {
    logger.info(`📝 Registering handler: ${handler.name}`);
    logger.info(`   Supported events: ${handler.supportedEvents.join(', ')}`);

    for (const eventType of handler.supportedEvents) {
      if (!this.handlers.has(eventType)) {
        this.handlers.set(eventType, []);
      }
      this.handlers.get(eventType)!.push(handler);
    }
  }

  /**
   * Start the event router
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Router already running');
      return;
    }

    this.running = true;
    logger.info('🚀 Outbox Event Router started');
    logger.info('📊 Registered handlers for events:');

    for (const [eventType, handlers] of this.handlers) {
      logger.info(`   - ${eventType}: ${handlers.map(h => h.name).join(', ')}`);
    }

    // Start polling
    this.pollInterval = setInterval(() => {
      this.processEvents().catch(err => {
        logger.error('Error processing outbox events:', err);
      });
    }, this.POLL_INTERVAL_MS);

    // Process immediately on start
    await this.processEvents();
  }

  /**
   * Stop the event router
   */
  async stop(): Promise<void> {
    logger.info('Stopping Outbox Event Router');
    this.running = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await managedDbPool.end();
  }

  /**
   * Poll and process events from outbox (SINGLE QUERY)
   */
  private async processEvents(): Promise<void> {
    const client = await managedDbPool.connect();

    try {
      // 1. Poll ALL unprocessed events (ONE QUERY)
      const result = await client.query<OutboxEvent>(
        `SELECT id, event_type, aggregate_type, aggregate_id, payload, created_at, retry_count
         FROM outbox_events
         WHERE processed_at IS NULL
           AND retry_count < $1
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [this.MAX_RETRIES, this.BATCH_SIZE]
      );

      if (result.rows.length === 0) {
        return;
      }

      logger.info(`📦 Processing ${result.rows.length} events...`);

      // 2. Route each event to its handlers
      for (const row of result.rows) {
        const event: OutboxEvent = {
          ...row,
          payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
        };

        try {
          await this.routeEvent(event);

          // 3. Mark as processed (ONE UPDATE)
          await client.query(
            `UPDATE outbox_events
             SET processed_at = NOW(),
                 last_error = NULL
             WHERE id = $1`,
            [event.id]
          );

          logger.debug(`✅ Processed event ${event.id} (${event.event_type})`);

        } catch (error) {
          // Increment retry count and record error
          const errorMessage = error instanceof Error ? error.message : String(error);
          await client.query(
            `UPDATE outbox_events
             SET retry_count = retry_count + 1,
                 last_error = $2
             WHERE id = $1`,
            [event.id, errorMessage]
          );

          logger.error(`❌ Failed to process event ${event.id}:`, error);
        }
      }

      logger.info(`✅ Successfully processed ${result.rows.length} events`);

    } catch (error) {
      logger.error('❌ Error in processEvents:', error);
    } finally {
      client.release();
    }
  }

  /**
   * Route an event to all registered handlers
   */
  private async routeEvent(event: OutboxEvent): Promise<void> {
    const handlers = this.handlers.get(event.event_type);

    if (!handlers || handlers.length === 0) {
      logger.warn(`⚠️  No handlers registered for event type: ${event.event_type}`);
      return;
    }

    // Execute all handlers in parallel
    const promises = handlers.map(async (handler) => {
      try {
        logger.debug(`   → Routing ${event.event_type} to ${handler.name}`);
        await handler.handle(event);
        logger.debug(`   ✅ ${handler.name} completed`);
      } catch (error) {
        logger.error(`❌ Error in handler ${handler.name}:`, error);
        throw error; // Re-throw so the event is marked for retry
      }
    });

    // Wait for all handlers to complete
    // If any fails, the event will be retried
    await Promise.all(promises);
  }

  /**
   * Get router statistics
   */
  async getStats(): Promise<any> {
    const result = await managedDbPool.query(`
      SELECT * FROM outbox_stats
      ORDER BY pending_count DESC
    `);

    return {
      handlers: {
        total: Array.from(this.handlers.values()).flat().length,
        by_event: Object.fromEntries(
          Array.from(this.handlers.entries()).map(([event, handlers]) => [
            event,
            handlers.map(h => h.name)
          ])
        )
      },
      events: result.rows
    };
  }

  /**
   * Clean up old processed events
   */
  async cleanup(retentionDays: number = 7): Promise<number> {
    const result = await managedDbPool.query(
      `SELECT cleanup_outbox_events($1)`,
      [retentionDays]
    );

    const deletedCount = result.rows[0].cleanup_outbox_events;
    logger.info(`🧹 Cleaned up ${deletedCount} old outbox events`);

    return deletedCount;
  }
}

// Singleton instance
export const outboxEventRouter = new OutboxEventRouter();

// Graceful shutdown handling
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await outboxEventRouter.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await outboxEventRouter.stop();
    process.exit(0);
  });
}
