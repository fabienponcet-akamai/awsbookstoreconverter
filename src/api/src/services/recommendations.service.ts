import { Pool } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('RecommendationsService');

// Create a connection pool for the graph database
const graphPool = new Pool({
  connectionString: process.env.GRAPH_DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

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
    try {
      logger.info(`Getting recommendations for user: ${userId}`);

      const result = await graphPool.query(
        `SELECT * FROM graph_get_recommendations($1, $2)`,
        [userId, limit]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.book_title,
        author: row.book_author,
        isbn: row.book_isbn,
        score: parseInt(row.recommendation_score, 10)
      }));
    } catch (error) {
      logger.error(`Error getting recommendations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Find users with similar purchase patterns
   */
  async findSimilarUsers(userId: string, limit: number = 10): Promise<SimilarUser[]> {
    try {
      logger.info(`Finding similar users for: ${userId}`);

      const result = await graphPool.query(
        `SELECT * FROM graph_find_similar_users($1, $2)`,
        [userId, limit]
      );

      return result.rows.map(row => ({
        userId: row.similar_user_id,
        name: row.similar_user_name,
        commonBooksCount: parseInt(row.common_books_count, 10)
      }));
    } catch (error) {
      logger.error(`Error finding similar users for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user's purchase history from the graph
   */
  async getUserPurchases(userId: string): Promise<UserPurchase[]> {
    try {
      logger.info(`Getting purchase history for user: ${userId}`);

      const result = await graphPool.query(
        `SELECT * FROM graph_get_user_purchases($1)`,
        [userId]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.book_title,
        author: row.book_author,
        purchaseDate: row.purchase_date,
        purchasePrice: parseFloat(row.purchase_price)
      }));
    } catch (error) {
      logger.error(`Error getting purchases for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Add or update a user in the graph database
   */
  async upsertUser(userId: string, keycloakId: string, email: string, name: string): Promise<void> {
    try {
      logger.info(`Upserting user in graph: ${userId}`);

      await graphPool.query(
        `SELECT graph_upsert_user($1, $2, $3, $4)`,
        [userId, keycloakId, email, name]
      );
    } catch (error) {
      logger.error(`Error upserting user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Add or update a book in the graph database
   */
  async upsertBook(bookId: string, isbn: string, title: string, author: string): Promise<void> {
    try {
      logger.info(`Upserting book in graph: ${bookId}`);

      await graphPool.query(
        `SELECT graph_upsert_book($1, $2, $3, $4)`,
        [bookId, isbn, title, author]
      );
    } catch (error) {
      logger.error(`Error upserting book ${bookId}:`, error);
      throw error;
    }
  }

  /**
   * Record a purchase in the graph database
   */
  async recordPurchase(
    userId: string,
    bookId: string,
    price: number,
    purchaseDate: Date = new Date()
  ): Promise<void> {
    try {
      logger.info(`Recording purchase: user=${userId}, book=${bookId}`);

      await graphPool.query(
        `SELECT graph_add_purchase($1, $2, $3, $4)`,
        [userId, bookId, price, purchaseDate]
      );
    } catch (error) {
      logger.error(`Error recording purchase:`, error);
      throw error;
    }
  }

  /**
   * Get trending books based on recent purchases
   */
  async getTrendingBooks(days: number = 7, limit: number = 10): Promise<BookRecommendation[]> {
    try {
      logger.info(`Getting trending books for last ${days} days`);

      const result = await graphPool.query(
        `SELECT * FROM graph_get_trending_books($1, $2)`,
        [days, limit]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.book_title,
        author: row.book_author,
        isbn: row.book_isbn,
        score: parseInt(row.purchase_count, 10)
      }));
    } catch (error) {
      logger.error('Error getting trending books:', error);
      throw error;
    }
  }

  /**
   * Get recommended books based on a specific book (similar books)
   * "Users who bought this also bought..."
   */
  async getSimilarBooks(bookId: string, limit: number = 10): Promise<BookRecommendation[]> {
    try {
      logger.info(`Getting similar books for: ${bookId}`);

      const result = await graphPool.query(
        `SELECT * FROM graph_get_similar_books($1, $2)`,
        [bookId, limit]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.book_title,
        author: row.book_author,
        isbn: row.book_isbn,
        score: parseInt(row.similarity_score, 10)
      }));
    } catch (error) {
      logger.error(`Error getting similar books for ${bookId}:`, error);
      throw error;
    }
  }

  /**
   * Close the database pool (for cleanup)
   */
  async close(): Promise<void> {
    await graphPool.end();
  }
}

// Export a singleton instance
export const recommendationsService = new RecommendationsService();
