import { Pool } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('GraphOutboxWorker');

// Connection pools
const managedDbPool = new Pool({
  connectionString: process.env.DATABASE_URL, // Managed DBaaS
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const graphDbPool = new Pool({
  connectionString: process.env.GRAPH_DATABASE_URL, // CloudNativePG with AGE
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

interface OutboxEvent {
  id: bigint;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
  retry_count: number;
}

export class GraphOutboxWorker {
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly POLL_INTERVAL_MS = 1000; // 1 second
  private readonly MAX_RETRIES = 5;

  /**
   * Start the outbox worker
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Worker already running');
      return;
    }

    this.running = true;
    logger.info('Starting Graph Outbox Worker');

    // Ensure AGE is loaded
    await this.initializeGraphDatabase();

    // Start polling
    this.pollInterval = setInterval(() => {
      this.processOutboxEvents().catch(err => {
        logger.error('Error processing outbox events:', err);
      });
    }, this.POLL_INTERVAL_MS);

    // Process immediately on start
    await this.processOutboxEvents();
  }

  /**
   * Stop the outbox worker
   */
  async stop(): Promise<void> {
    logger.info('Stopping Graph Outbox Worker');
    this.running = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await managedDbPool.end();
    await graphDbPool.end();
  }

  /**
   * Initialize graph database connection
   */
  private async initializeGraphDatabase(): Promise<void> {
    try {
      await graphDbPool.query(`LOAD 'age';`);
      await graphDbPool.query(`SET search_path = ag_catalog, "$user", public;`);
      logger.info('Graph database initialized with Apache AGE');
    } catch (error) {
      logger.error('Failed to initialize graph database:', error);
      throw error;
    }
  }

  /**
   * Process a batch of outbox events
   */
  private async processOutboxEvents(): Promise<void> {
    const client = await managedDbPool.connect();

    try {
      // Fetch unprocessed events
      const result = await client.query<OutboxEvent>(
        `SELECT id, aggregate_type, aggregate_id, event_type, payload, retry_count
         FROM graph_outbox
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

      logger.info(`Processing ${result.rows.length} outbox events`);

      // Process each event
      for (const event of result.rows) {
        try {
          await this.processEvent(event);

          // Mark as processed
          await client.query(
            `UPDATE graph_outbox
             SET processed_at = NOW(),
                 last_error = NULL
             WHERE id = $1`,
            [event.id]
          );

          logger.debug(`Processed event ${event.id} (${event.aggregate_type}:${event.event_type})`);
        } catch (error) {
          // Increment retry count and record error
          const errorMessage = error instanceof Error ? error.message : String(error);
          await client.query(
            `UPDATE graph_outbox
             SET retry_count = retry_count + 1,
                 last_error = $2
             WHERE id = $1`,
            [event.id, errorMessage]
          );

          logger.error(`Failed to process event ${event.id}:`, error);
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Process a single outbox event
   */
  private async processEvent(event: OutboxEvent): Promise<void> {
    switch (event.aggregate_type) {
      case 'user':
        await this.processUserEvent(event);
        break;
      case 'book':
        await this.processBookEvent(event);
        break;
      case 'purchase':
        await this.processPurchaseEvent(event);
        break;
      default:
        logger.warn(`Unknown aggregate type: ${event.aggregate_type}`);
    }
  }

  /**
   * Process user event
   */
  private async processUserEvent(event: OutboxEvent): Promise<void> {
    const { id, keycloak_id, email, name } = event.payload;

    if (event.event_type === 'deleted') {
      // Delete user vertex
      await graphDbPool.query(
        `SELECT * FROM cypher('social_network', $$
          MATCH (u:User {id: $user_id})
          DETACH DELETE u
        $$, $1::agtype) as (result agtype)`,
        [JSON.stringify({ user_id: id })]
      );
    } else {
      // Upsert user vertex
      await graphDbPool.query(
        `SELECT * FROM cypher('social_network', $$
          MERGE (u:User {id: $user_id})
          SET u.keycloakId = $keycloak_id,
              u.email = $email,
              u.name = $name,
              u.updatedAt = timestamp()
        $$, $1::agtype) as (result agtype)`,
        [JSON.stringify({ user_id: id, keycloak_id, email, name })]
      );
    }
  }

  /**
   * Process book event
   */
  private async processBookEvent(event: OutboxEvent): Promise<void> {
    const { id, isbn, title, author, category } = event.payload;

    if (event.event_type === 'deleted') {
      // Delete book vertex
      await graphDbPool.query(
        `SELECT * FROM cypher('social_network', $$
          MATCH (b:Book {id: $book_id})
          DETACH DELETE b
        $$, $1::agtype) as (result agtype)`,
        [JSON.stringify({ book_id: id })]
      );
    } else {
      // Upsert book vertex
      await graphDbPool.query(
        `SELECT * FROM cypher('social_network', $$
          MERGE (b:Book {id: $book_id})
          SET b.isbn = $isbn,
              b.title = $title,
              b.author = $author,
              b.category = $category,
              b.updatedAt = timestamp()
        $$, $1::agtype) as (result agtype)`,
        [JSON.stringify({ book_id: id, isbn, title, author, category: category || '' })]
      );
    }
  }

  /**
   * Process purchase event (creates edge in graph)
   */
  private async processPurchaseEvent(event: OutboxEvent): Promise<void> {
    const { user_id, book_id, price, purchase_date, order_id } = event.payload;

    if (event.event_type === 'created') {
      // Create purchase edge between user and book
      await graphDbPool.query(
        `SELECT * FROM cypher('social_network', $$
          MATCH (u:User {id: $user_id})
          MATCH (b:Book {id: $book_id})
          MERGE (u)-[p:PURCHASED {orderId: $order_id}]->(b)
          SET p.price = $price,
              p.date = $purchase_date,
              p.timestamp = timestamp()
        $$, $1::agtype) as (result agtype)`,
        [JSON.stringify({ user_id, book_id, order_id, price, purchase_date })]
      );
    }
  }

  /**
   * Get worker statistics
   */
  async getStats(): Promise<any> {
    const result = await managedDbPool.query(`
      SELECT * FROM graph_outbox_stats
    `);

    return result.rows;
  }

  /**
   * Manually trigger cleanup of old processed events
   */
  async cleanup(retentionDays: number = 7): Promise<number> {
    const result = await managedDbPool.query(
      `SELECT cleanup_graph_outbox($1)`,
      [retentionDays]
    );

    const deletedCount = result.rows[0].cleanup_graph_outbox;
    logger.info(`Cleaned up ${deletedCount} old outbox events`);

    return deletedCount;
  }
}

// Singleton instance
export const graphOutboxWorker = new GraphOutboxWorker();

// Graceful shutdown handling
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await graphOutboxWorker.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await graphOutboxWorker.stop();
    process.exit(0);
  });
}
