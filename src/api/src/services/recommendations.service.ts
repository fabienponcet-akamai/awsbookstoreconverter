import neo4j, { Driver, Session } from 'neo4j-driver';
import { createLogger } from '../utils/logger';

const logger = createLogger('RecommendationsService');

// Create Neo4j driver for the graph database
const neo4jUri = process.env.NEO4J_URI || 'bolt://bookstore-graph:7687';
const neo4jUsername = process.env.NEO4J_USERNAME || 'neo4j';
const neo4jPassword = process.env.NEO4J_PASSWORD || 'changeme';

const driver = neo4j.driver(
  neo4jUri,
  neo4j.auth.basic(neo4jUsername, neo4jPassword),
  {
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 30000
  }
);

logger.info(`Neo4j driver initialized: ${neo4jUri}`);

export interface BookRecommendation {
  bookId: string;
  title: string;
  author: string;
  isbn: string;
  score: number;
}

export interface SimilarUser {
  userId: string;
  name: string;
  commonBooksCount: number;
}

export interface UserPurchase {
  bookId: string;
  title: string;
  author: string;
  purchaseDate: string;
  purchasePrice: number;
}

export class RecommendationsService {
  /**
   * Get personalized book recommendations for a user using collaborative filtering
   */
  async getRecommendations(userId: string, limit: number = 10): Promise<BookRecommendation[]> {
    const session = driver.session();
    try {
      logger.info(`Getting recommendations for user: ${userId}`);

      const result = await session.run(
        `MATCH (user:User {id: $userId})-[:PURCHASED]->(book:Book)
               <-[:PURCHASED]-(other:User)-[:PURCHASED]->(rec:Book)
         WHERE NOT (user)-[:PURCHASED]->(rec)
         RETURN rec.id as bookId,
                rec.title as title,
                rec.author as author,
                rec.isbn as isbn,
                COUNT(DISTINCT other) as score
         ORDER BY score DESC
         LIMIT $limit`,
        { userId, limit: neo4j.int(limit) }
      );

      return result.records.map(record => ({
        bookId: record.get('bookId'),
        title: record.get('title'),
        author: record.get('author'),
        isbn: record.get('isbn'),
        score: record.get('score').toNumber()
      }));
    } catch (error) {
      logger.error(`Error getting recommendations for user ${userId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Find users with similar purchase patterns
   */
  async findSimilarUsers(userId: string, limit: number = 10): Promise<SimilarUser[]> {
    const session = driver.session();
    try {
      logger.info(`Finding similar users for: ${userId}`);

      const result = await session.run(
        `MATCH (user:User {id: $userId})-[:PURCHASED]->(book:Book)
               <-[:PURCHASED]-(similar:User)
         WHERE user.id <> similar.id
         RETURN similar.id as userId,
                similar.name as name,
                COUNT(DISTINCT book) as commonBooksCount
         ORDER BY commonBooksCount DESC
         LIMIT $limit`,
        { userId, limit: neo4j.int(limit) }
      );

      return result.records.map(record => ({
        userId: record.get('userId'),
        name: record.get('name'),
        commonBooksCount: record.get('commonBooksCount').toNumber()
      }));
    } catch (error) {
      logger.error(`Error finding similar users for ${userId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get user's purchase history from the graph
   */
  async getUserPurchases(userId: string): Promise<UserPurchase[]> {
    const session = driver.session();
    try {
      logger.info(`Getting purchase history for user: ${userId}`);

      const result = await session.run(
        `MATCH (user:User {id: $userId})-[p:PURCHASED]->(book:Book)
         RETURN book.id as bookId,
                book.title as title,
                book.author as author,
                p.purchaseDate as purchaseDate,
                p.price as purchasePrice
         ORDER BY p.purchaseDate DESC`,
        { userId }
      );

      return result.records.map(record => ({
        bookId: record.get('bookId'),
        title: record.get('title'),
        author: record.get('author'),
        purchaseDate: record.get('purchaseDate').toString(),
        purchasePrice: record.get('purchasePrice')
      }));
    } catch (error) {
      logger.error(`Error getting purchases for user ${userId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get trending books based on recent purchases
   */
  async getTrendingBooks(days: number = 7, limit: number = 10): Promise<BookRecommendation[]> {
    const session = driver.session();
    try {
      logger.info(`Getting trending books for last ${days} days`);

      const result = await session.run(
        `MATCH (u:User)-[p:PURCHASED]->(book:Book)
         WHERE p.purchaseDate > datetime() - duration({days: $days})
         RETURN book.id as bookId,
                book.title as title,
                book.author as author,
                book.isbn as isbn,
                COUNT(*) as score
         ORDER BY score DESC
         LIMIT $limit`,
        { days: neo4j.int(days), limit: neo4j.int(limit) }
      );

      return result.records.map(record => ({
        bookId: record.get('bookId'),
        title: record.get('title'),
        author: record.get('author'),
        isbn: record.get('isbn'),
        score: record.get('score').toNumber()
      }));
    } catch (error) {
      logger.error('Error getting trending books:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get recommended books based on a specific book (similar books)
   * "Users who bought this also bought..."
   */
  async getSimilarBooks(bookId: string, limit: number = 10): Promise<BookRecommendation[]> {
    const session = driver.session();
    try {
      logger.info(`Getting similar books for: ${bookId}`);

      const result = await session.run(
        `MATCH (book:Book {id: $bookId})<-[:PURCHASED]-(u:User)
               -[:PURCHASED]->(rec:Book)
         WHERE book.id <> rec.id
         RETURN rec.id as bookId,
                rec.title as title,
                rec.author as author,
                rec.isbn as isbn,
                COUNT(DISTINCT u) as score
         ORDER BY score DESC
         LIMIT $limit`,
        { bookId, limit: neo4j.int(limit) }
      );

      return result.records.map(record => ({
        bookId: record.get('bookId'),
        title: record.get('title'),
        author: record.get('author'),
        isbn: record.get('isbn'),
        score: record.get('score').toNumber()
      }));
    } catch (error) {
      logger.error(`Error getting similar books for ${bookId}:`, error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<any> {
    const session = driver.session();
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
      logger.error('Error getting stats:', error);
      return { users: 0, books: 0, purchases: 0 };
    } finally {
      await session.close();
    }
  }

  /**
   * Close the driver (for cleanup)
   */
  async close(): Promise<void> {
    await driver.close();
    logger.info('Neo4j driver closed');
  }
}

// Export a singleton instance
export const recommendationsService = new RecommendationsService();

// Graceful shutdown handling
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing Neo4j driver');
    await recommendationsService.close();
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing Neo4j driver');
    await recommendationsService.close();
  });
}
