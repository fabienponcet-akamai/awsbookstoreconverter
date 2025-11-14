import { Pool } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('CacheService');

// Use main database for cache (could also be a separate cluster if needed)
const cachePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export class CacheService {
  /**
   * Get value from PostgreSQL cache
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const result = await cachePool.query(
        'SELECT cache_get($1) as value',
        [key]
      );

      return result.rows[0]?.value || null;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in PostgreSQL cache with TTL
   */
  async set(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    try {
      await cachePool.query(
        'SELECT cache_set($1, $2, $3)',
        [key, JSON.stringify(value), ttlSeconds]
      );
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await cachePool.query(
        'SELECT cache_delete($1)',
        [key]
      );
    } catch (error) {
      logger.error(`Cache DELETE error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete cache entries matching pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const result = await cachePool.query(
        'SELECT cache_delete_pattern($1) as deleted',
        [pattern]
      );

      return parseInt(result.rows[0]?.deleted || '0', 10);
    } catch (error) {
      logger.error(`Cache DELETE PATTERN error for pattern ${pattern}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup expired cache entries (manual trigger)
   */
  async cleanupExpired(): Promise<number> {
    try {
      const result = await cachePool.query(
        'SELECT cache_cleanup_expired() as deleted'
      );

      const deleted = parseInt(result.rows[0]?.deleted || '0', 10);
      logger.info(`Cleaned up ${deleted} expired cache entries`);
      return deleted;
    } catch (error) {
      logger.error('Cache cleanup error:', error);
      throw error;
    }
  }

  /**
   * Cache a function result with automatic key generation
   */
  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 3600
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      logger.debug(`Cache HIT for key: ${key}`);
      return cached;
    }

    // Cache miss - execute function
    logger.debug(`Cache MISS for key: ${key}`);
    const result = await fn();

    // Store in cache
    await this.set(key, result, ttlSeconds);

    return result;
  }

  /**
   * Close the database pool
   */
  async close(): Promise<void> {
    await cachePool.end();
  }
}

// Export singleton instance
export const cacheService = new CacheService();
