import { Pool } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('LeaderboardService');

// Use main database for leaderboard
const leaderboardPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export interface LeaderboardEntry {
  bookId: string;
  title: string;
  author: string;
  score: number;
  salesCount: number;
  ratingAvg: number;
}

export interface TrendingBook {
  bookId: string;
  title: string;
  author: string;
  recentSales: number;
}

export class LeaderboardService {
  /**
   * Increment book score (called after purchase)
   */
  async incrementScore(bookId: string, increment: number = 1): Promise<void> {
    try {
      await leaderboardPool.query(
        'SELECT leaderboard_increment_score($1::uuid, $2)',
        [bookId, increment]
      );

      logger.info(`Incremented leaderboard score for book ${bookId} by ${increment}`);
    } catch (error) {
      logger.error(`Error incrementing leaderboard for book ${bookId}:`, error);
      throw error;
    }
  }

  /**
   * Get top N bestselling books
   */
  async getTop(limit: number = 20): Promise<LeaderboardEntry[]> {
    try {
      const result = await leaderboardPool.query(
        'SELECT * FROM leaderboard_get_top($1)',
        [limit]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        score: parseInt(row.score, 10),
        salesCount: parseInt(row.sales_count, 10),
        ratingAvg: parseFloat(row.rating_avg)
      }));
    } catch (error) {
      logger.error('Error getting top books from leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get trending books (most sales in last N days)
   */
  async getTrending(days: number = 7, limit: number = 20): Promise<TrendingBook[]> {
    try {
      const result = await leaderboardPool.query(
        'SELECT * FROM leaderboard_get_trending($1, $2)',
        [days, limit]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        recentSales: parseInt(row.recent_sales, 10)
      }));
    } catch (error) {
      logger.error('Error getting trending books:', error);
      throw error;
    }
  }

  /**
   * Update book rating in leaderboard
   */
  async updateRating(bookId: string, rating: number): Promise<void> {
    try {
      await leaderboardPool.query(
        'SELECT leaderboard_update_rating($1::uuid, $2)',
        [bookId, rating]
      );

      logger.info(`Updated rating for book ${bookId}: ${rating}`);
    } catch (error) {
      logger.error(`Error updating rating for book ${bookId}:`, error);
      throw error;
    }
  }

  /**
   * Get book rank in leaderboard
   */
  async getBookRank(bookId: string): Promise<number | null> {
    try {
      const result = await leaderboardPool.query(
        `SELECT rank
         FROM (
           SELECT book_id, ROW_NUMBER() OVER (ORDER BY score DESC) as rank
           FROM leaderboard
         ) ranked
         WHERE book_id = $1::uuid`,
        [bookId]
      );

      return result.rows[0]?.rank ? parseInt(result.rows[0].rank, 10) : null;
    } catch (error) {
      logger.error(`Error getting rank for book ${bookId}:`, error);
      return null;
    }
  }

  /**
   * Close the database pool
   */
  async close(): Promise<void> {
    await leaderboardPool.end();
  }
}

// Export singleton instance
export const leaderboardService = new LeaderboardService();
