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
  isbn: string;
  category: string;
  price: number;
  score: number;
  salesCount: number;
  totalQuantity: number;
  ratingAvg: number;
  reviewCount: number;
  lastPurchaseAt: Date | null;
}

export interface TrendingBook {
  bookId: string;
  title: string;
  author: string;
  recentSales: number;
  recentQuantity: number;
  trendScore: number;
}

export interface BookRank {
  rank: number;
  bookId: string;
  title: string;
  score: number;
  salesCount: number;
}

/**
 * Leaderboard Service using PostgreSQL Materialized View
 *
 * Replaces Redis Sorted Sets with a PostgreSQL materialized view
 * that automatically computes bestseller rankings from orders.
 *
 * Benefits over manual table updates:
 * - Single source of truth (orders table)
 * - No risk of getting out of sync
 * - Automatic computation via scheduled refresh
 * - Can refresh concurrently (non-blocking reads)
 * - Weighted scoring by recency and quantity
 *
 * The materialized view is refreshed:
 * - Every minute via pg_cron (recommended)
 * - Or automatically after ~10% of orders via trigger
 * - Or manually via refresh() method
 */
export class LeaderboardService {
  /**
   * Refresh the leaderboard materialized view
   * Called periodically by pg_cron or manually when needed
   * Uses REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking)
   */
  async refresh(): Promise<void> {
    try {
      await leaderboardPool.query('SELECT leaderboard_refresh()');
      logger.info('Leaderboard materialized view refreshed successfully');
    } catch (error) {
      logger.error('Error refreshing leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get top N bestselling books
   * Queries the materialized view (very fast)
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
        isbn: row.isbn,
        category: row.category,
        price: parseFloat(row.price),
        score: parseInt(row.score, 10),
        salesCount: parseInt(row.sales_count, 10),
        totalQuantity: parseInt(row.total_quantity, 10),
        ratingAvg: parseFloat(row.rating_avg),
        reviewCount: parseInt(row.review_count, 10),
        lastPurchaseAt: row.last_purchase_at ? new Date(row.last_purchase_at) : null
      }));
    } catch (error) {
      logger.error('Error getting top books from leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get top N bestselling books by category
   */
  async getTopByCategory(category: string, limit: number = 20): Promise<LeaderboardEntry[]> {
    try {
      const result = await leaderboardPool.query(
        'SELECT * FROM leaderboard_get_top_by_category($1, $2)',
        [category, limit]
      );

      return result.rows.map(row => ({
        bookId: row.book_id,
        title: row.title,
        author: row.author,
        isbn: '',
        category: category,
        price: 0,
        score: parseInt(row.score, 10),
        salesCount: parseInt(row.sales_count, 10),
        totalQuantity: 0,
        ratingAvg: parseFloat(row.rating_avg),
        reviewCount: 0,
        lastPurchaseAt: null
      }));
    } catch (error) {
      logger.error(`Error getting top books for category ${category}:`, error);
      throw error;
    }
  }

  /**
   * Get trending books (most sales in last N days)
   * Computed in real-time from orders (not from materialized view)
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
        recentSales: parseInt(row.recent_sales, 10),
        recentQuantity: parseInt(row.recent_quantity, 10),
        trendScore: parseInt(row.trend_score, 10)
      }));
    } catch (error) {
      logger.error('Error getting trending books:', error);
      throw error;
    }
  }

  /**
   * Get book rank in leaderboard
   */
  async getBookRank(bookId: string): Promise<BookRank | null> {
    try {
      const result = await leaderboardPool.query(
        'SELECT * FROM leaderboard_get_book_rank($1::uuid)',
        [bookId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        rank: parseInt(row.rank, 10),
        bookId: row.book_id,
        title: row.title,
        score: parseInt(row.score, 10),
        salesCount: parseInt(row.sales_count, 10)
      };
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
