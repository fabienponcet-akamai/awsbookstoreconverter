import { Pool } from 'pg';
import { IEventHandler, OutboxEvent } from '../outbox-event-router';
import { createLogger } from '../../utils/logger';

const logger = createLogger('RecommendationsSyncHandler');

// Connection pool for CloudNativePG/AGE cluster
const graphDbPool = new Pool({
  connectionString: process.env.GRAPH_DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Recommendations Sync Handler
 *
 * Syncs data to CloudNativePG cluster with Apache AGE for graph-based recommendations
 *
 * Handles:
 * - user_created/updated → Upsert User vertex
 * - user_deleted → Delete User vertex
 * - book_created/updated → Upsert Book vertex
 * - book_deleted → Delete Book vertex
 * - book_purchased → Create PURCHASED edge
 */
export class RecommendationsSyncHandler implements IEventHandler {
  name = 'RecommendationsSyncHandler';
  supportedEvents = [
    'user_created',
    'user_updated',
    'user_deleted',
    'book_created',
    'book_updated',
    'book_deleted',
    'book_purchased'
  ];

  private initialized = false;

  async handle(event: OutboxEvent): Promise<void> {
    // Lazy initialization of AGE
    if (!this.initialized) {
      await this.initializeGraphDatabase();
      this.initialized = true;
    }

    const { event_type, payload } = event;

    switch (event_type) {
      case 'user_created':
      case 'user_updated':
        await this.upsertUserVertex(payload);
        break;

      case 'user_deleted':
        await this.deleteUserVertex(payload.id);
        break;

      case 'book_created':
      case 'book_updated':
        await this.upsertBookVertex(payload);
        break;

      case 'book_deleted':
        await this.deleteBookVertex(payload.id);
        break;

      case 'book_purchased':
        await this.createPurchaseEdge(payload);
        break;

      default:
        logger.warn(`Unexpected event type: ${event_type}`);
    }
  }

  /**
   * Initialize AGE extension and search path
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
   * Upsert User vertex in AGE
   */
  private async upsertUserVertex(user: any): Promise<void> {
    await graphDbPool.query(
      `SELECT * FROM cypher('social_network', $$
        MERGE (u:User {id: $user_id})
        SET u.keycloakId = $keycloak_id,
            u.email = $email,
            u.name = $name,
            u.updatedAt = timestamp()
      $$, $1::agtype) as (result agtype)`,
      [JSON.stringify({
        user_id: user.id,
        keycloak_id: user.keycloak_id || '',
        email: user.email || '',
        name: user.name || ''
      })]
    );

    logger.info(`✅ RecoSync: Upserted User vertex ${user.id}`);
  }

  /**
   * Delete User vertex from AGE
   */
  private async deleteUserVertex(userId: string): Promise<void> {
    await graphDbPool.query(
      `SELECT * FROM cypher('social_network', $$
        MATCH (u:User {id: $user_id})
        DETACH DELETE u
      $$, $1::agtype) as (result agtype)`,
      [JSON.stringify({ user_id: userId })]
    );

    logger.info(`✅ RecoSync: Deleted User vertex ${userId}`);
  }

  /**
   * Upsert Book vertex in AGE
   */
  private async upsertBookVertex(book: any): Promise<void> {
    await graphDbPool.query(
      `SELECT * FROM cypher('social_network', $$
        MERGE (b:Book {id: $book_id})
        SET b.isbn = $isbn,
            b.title = $title,
            b.author = $author,
            b.category = $category,
            b.price = $price,
            b.updatedAt = timestamp()
      $$, $1::agtype) as (result agtype)`,
      [JSON.stringify({
        book_id: book.id,
        isbn: book.isbn || '',
        title: book.title || '',
        author: book.author || '',
        category: book.category || '',
        price: book.price || 0
      })]
    );

    logger.info(`✅ RecoSync: Upserted Book vertex ${book.id} (${book.title})`);
  }

  /**
   * Delete Book vertex from AGE
   */
  private async deleteBookVertex(bookId: string): Promise<void> {
    await graphDbPool.query(
      `SELECT * FROM cypher('social_network', $$
        MATCH (b:Book {id: $book_id})
        DETACH DELETE b
      $$, $1::agtype) as (result agtype)`,
      [JSON.stringify({ book_id: bookId })]
    );

    logger.info(`✅ RecoSync: Deleted Book vertex ${bookId}`);
  }

  /**
   * Create PURCHASED edge between User and Book
   */
  private async createPurchaseEdge(purchase: any): Promise<void> {
    const { user_id, book_id, price, purchase_date, order_id } = purchase;

    // First ensure both vertices exist
    await this.ensureUserExists(user_id);
    await this.ensureBookExists(book_id);

    // Create PURCHASED edge
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

    logger.info(`✅ RecoSync: Created PURCHASED edge (User ${user_id} → Book ${book_id})`);
  }

  /**
   * Ensure User vertex exists (create if missing)
   */
  private async ensureUserExists(userId: string): Promise<void> {
    await graphDbPool.query(
      `SELECT * FROM cypher('social_network', $$
        MERGE (u:User {id: $user_id})
        ON CREATE SET u.name = 'Unknown', u.email = '', u.keycloakId = ''
      $$, $1::agtype) as (result agtype)`,
      [JSON.stringify({ user_id: userId })]
    );
  }

  /**
   * Ensure Book vertex exists (create if missing)
   */
  private async ensureBookExists(bookId: string): Promise<void> {
    await graphDbPool.query(
      `SELECT * FROM cypher('social_network', $$
        MERGE (b:Book {id: $book_id})
        ON CREATE SET b.title = 'Unknown', b.author = '', b.isbn = ''
      $$, $1::agtype) as (result agtype)`,
      [JSON.stringify({ book_id: bookId })]
    );
  }

  /**
   * Close database connection (for cleanup)
   */
  async close(): Promise<void> {
    await graphDbPool.end();
  }
}
