import neo4j, { Driver, Session } from 'neo4j-driver';
import { IEventHandler, OutboxEvent } from '../outbox-event-router';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Neo4jRecommendationsHandler');

/**
 * Neo4j Recommendations Handler
 *
 * Syncs data to Neo4j graph database for graph-based recommendations
 *
 * Handles:
 * - user_created/updated → Upsert User node
 * - user_deleted → Delete User node
 * - book_created/updated → Upsert Book node
 * - book_deleted → Delete Book node
 * - book_purchased → Create PURCHASED relationship
 */
export class Neo4jRecommendationsHandler implements IEventHandler {
  name = 'Neo4jRecommendationsHandler';
  supportedEvents = [
    'user_created',
    'user_updated',
    'user_deleted',
    'book_created',
    'book_updated',
    'book_deleted',
    'book_purchased'
  ];

  private driver: Driver;

  constructor() {
    // Initialize Neo4j driver
    const uri = process.env.NEO4J_URI || 'bolt://bookstore-graph:7687';
    const username = process.env.NEO4J_USERNAME || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'changeme';

    this.driver = neo4j.driver(
      uri,
      neo4j.auth.basic(username, password),
      {
        maxConnectionPoolSize: 10,
        connectionAcquisitionTimeout: 30000
      }
    );

    logger.info(`Neo4j driver initialized: ${uri}`);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const { event_type, payload } = event;

    switch (event_type) {
      case 'user_created':
      case 'user_updated':
        await this.upsertUserNode(payload);
        break;

      case 'user_deleted':
        await this.deleteUserNode(payload.id);
        break;

      case 'book_created':
      case 'book_updated':
        await this.upsertBookNode(payload);
        break;

      case 'book_deleted':
        await this.deleteBookNode(payload.id);
        break;

      case 'book_purchased':
        await this.createPurchaseRelationship(payload);
        break;

      default:
        logger.warn(`Unexpected event type: ${event_type}`);
    }
  }

  /**
   * Upsert User node in Neo4j
   */
  private async upsertUserNode(user: any): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (u:User {id: $id})
         SET u.keycloakId = $keycloakId,
             u.email = $email,
             u.name = $name,
             u.updatedAt = datetime()`,
        {
          id: user.id,
          keycloakId: user.keycloak_id || '',
          email: user.email || '',
          name: user.name || ''
        }
      );

      logger.info(`✅ Neo4j: Upserted User node ${user.id}`);
    } catch (error) {
      logger.error(`Failed to upsert user ${user.id}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Delete User node from Neo4j
   */
  private async deleteUserNode(userId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (u:User {id: $id})
         DETACH DELETE u`,
        { id: userId }
      );

      logger.info(`✅ Neo4j: Deleted User node ${userId}`);
    } catch (error) {
      logger.error(`Failed to delete user ${userId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Upsert Book node in Neo4j
   */
  private async upsertBookNode(book: any): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (b:Book {id: $id})
         SET b.isbn = $isbn,
             b.title = $title,
             b.author = $author,
             b.category = $category,
             b.price = $price,
             b.updatedAt = datetime()`,
        {
          id: book.id,
          isbn: book.isbn || '',
          title: book.title || '',
          author: book.author || '',
          category: book.category || '',
          price: book.price || 0
        }
      );

      logger.info(`✅ Neo4j: Upserted Book node ${book.id} (${book.title})`);
    } catch (error) {
      logger.error(`Failed to upsert book ${book.id}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Delete Book node from Neo4j
   */
  private async deleteBookNode(bookId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (b:Book {id: $id})
         DETACH DELETE b`,
        { id: bookId }
      );

      logger.info(`✅ Neo4j: Deleted Book node ${bookId}`);
    } catch (error) {
      logger.error(`Failed to delete book ${bookId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Create PURCHASED relationship between User and Book
   */
  private async createPurchaseRelationship(purchase: any): Promise<void> {
    const { user_id, book_id, price, purchase_date, order_id, quantity } = purchase;

    const session = this.driver.session();
    try {
      // Ensure both nodes exist, then create relationship
      await session.run(
        `MERGE (u:User {id: $userId})
         MERGE (b:Book {id: $bookId})
         MERGE (u)-[p:PURCHASED {orderId: $orderId}]->(b)
         SET p.price = $price,
             p.quantity = $quantity,
             p.purchaseDate = datetime($purchaseDate),
             p.createdAt = datetime()`,
        {
          userId: user_id,
          bookId: book_id,
          orderId: order_id,
          price: price || 0,
          quantity: quantity || 1,
          purchaseDate: purchase_date || new Date().toISOString()
        }
      );

      logger.info(`✅ Neo4j: Created PURCHASED relationship (User ${user_id} → Book ${book_id})`);
    } catch (error) {
      logger.error(`Failed to create purchase relationship:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Verify Neo4j connection
   */
  async verifyConnectivity(): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run('RETURN 1 as test');
      logger.info('✅ Neo4j connectivity verified');
      return true;
    } catch (error) {
      logger.error('❌ Neo4j connectivity failed:', error);
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Get statistics from Neo4j
   */
  async getStats(): Promise<any> {
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (u:User) WITH count(u) as users
        MATCH (b:Book) WITH users, count(b) as books
        MATCH ()-[p:PURCHASED]->() WITH users, books, count(p) as purchases
        RETURN users, books, purchases
      `);

      const record = result.records[0];
      return {
        users: record.get('users').toNumber(),
        books: record.get('books').toNumber(),
        purchases: record.get('purchases').toNumber()
      };
    } catch (error) {
      logger.error('Failed to get Neo4j stats:', error);
      return { users: 0, books: 0, purchases: 0 };
    } finally {
      await session.close();
    }
  }

  /**
   * Close Neo4j driver (for cleanup)
   */
  async close(): Promise<void> {
    await this.driver.close();
    logger.info('Neo4j driver closed');
  }
}

/**
 * Example queries for the recommendation service to use:
 *
 * 1. Personalized recommendations (collaborative filtering):
 * ```cypher
 * MATCH (user:User {id: $userId})-[:PURCHASED]->(book:Book)
 *       <-[:PURCHASED]-(other:User)-[:PURCHASED]->(rec:Book)
 * WHERE NOT (user)-[:PURCHASED]->(rec)
 * RETURN rec.id, rec.title, rec.author, COUNT(DISTINCT other) as score
 * ORDER BY score DESC
 * LIMIT 10
 * ```
 *
 * 2. Similar books ("customers who bought this also bought"):
 * ```cypher
 * MATCH (book:Book {id: $bookId})<-[:PURCHASED]-(user:User)
 *       -[:PURCHASED]->(rec:Book)
 * WHERE book.id <> rec.id
 * RETURN rec.id, rec.title, rec.author, COUNT(DISTINCT user) as score
 * ORDER BY score DESC
 * LIMIT 10
 * ```
 *
 * 3. Similar users (by purchase patterns):
 * ```cypher
 * MATCH (user:User {id: $userId})-[:PURCHASED]->(book:Book)
 *       <-[:PURCHASED]-(similar:User)
 * WHERE user.id <> similar.id
 * RETURN similar.id, similar.name, COUNT(DISTINCT book) as commonBooks
 * ORDER BY commonBooks DESC
 * LIMIT 10
 * ```
 *
 * 4. Trending books (recent purchases):
 * ```cypher
 * MATCH (u:User)-[p:PURCHASED]->(b:Book)
 * WHERE p.purchaseDate > datetime() - duration({days: 7})
 * RETURN b.id, b.title, b.author, COUNT(*) as purchaseCount
 * ORDER BY purchaseCount DESC
 * LIMIT 10
 * ```
 */
