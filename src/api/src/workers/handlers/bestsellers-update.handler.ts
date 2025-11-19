import { IEventHandler, OutboxEvent } from '../outbox-event-router';
import { createLogger } from '../../utils/logger';

const logger = createLogger('BestsellersUpdateHandler');

// Redis client (would import from redis library in production)
// import { createClient } from 'redis';

// For now, we'll mock the Redis client - replace with real implementation
const redisClient = {
  async zIncrBy(key: string, increment: number, member: string): Promise<number> {
    logger.debug(`  [Redis] ZINCRBY ${key} ${increment} ${member}`);
    return increment; // Mock return value
  },
  async zRemRangeByRank(key: string, start: number, stop: number): Promise<number> {
    logger.debug(`  [Redis] ZREMRANGEBYRANK ${key} ${start} ${stop}`);
    return 0; // Mock return value
  },
  async zCard(key: string): Promise<number> {
    logger.debug(`  [Redis] ZCARD ${key}`);
    return 1000; // Mock return value
  }
};

/**
 * Bestsellers Update Handler
 *
 * Updates bestsellers ranking in Redis using sorted sets
 *
 * Handles:
 * - bestseller_increment → Increment book score in Redis sorted set
 *
 * Redis Structure:
 * - Key: "bestsellers"
 * - Type: Sorted Set (ZSET)
 * - Members: book_id
 * - Score: total quantity sold
 * - Top 1000 books are kept
 */
export class BestsellersUpdateHandler implements IEventHandler {
  name = 'BestsellersUpdateHandler';
  supportedEvents = ['bestseller_increment'];

  private readonly BESTSELLERS_KEY = 'bestsellers';
  private readonly MAX_BESTSELLERS = 1000;

  async handle(event: OutboxEvent): Promise<void> {
    const { payload } = event;
    const { book_id, quantity } = payload;

    // Increment the book's score in the sorted set
    const newScore = await redisClient.zIncrBy(
      this.BESTSELLERS_KEY,
      quantity || 1,
      book_id
    );

    logger.info(`✅ Bestsellers: ZINCRBY ${book_id} +${quantity} → ${newScore}`);

    // Trim to keep only top N bestsellers
    await this.trimBestsellers();
  }

  /**
   * Trim the bestsellers sorted set to keep only top N books
   */
  private async trimBestsellers(): Promise<void> {
    // Get current size
    const currentSize = await redisClient.zCard(this.BESTSELLERS_KEY);

    if (currentSize > this.MAX_BESTSELLERS) {
      // Remove books outside top N
      // ZREMRANGEBYRANK removes elements from rank 0 to (-(MAX+1))
      // This keeps only the top MAX elements
      const removed = await redisClient.zRemRangeByRank(
        this.BESTSELLERS_KEY,
        0,
        -(this.MAX_BESTSELLERS + 1)
      );

      if (removed > 0) {
        logger.info(`🧹 Bestsellers: Trimmed ${removed} books (keeping top ${this.MAX_BESTSELLERS})`);
      }
    }
  }
}

/**
 * Example Redis queries for bestsellers:
 *
 * Get top 10 bestsellers:
 * ZREVRANGE bestsellers 0 9 WITHSCORES
 *
 * Get rank of a specific book:
 * ZREVRANK bestsellers book-123
 *
 * Get score of a specific book:
 * ZSCORE bestsellers book-123
 *
 * Get top N with details (requires lookup in main DB):
 * ZREVRANGE bestsellers 0 9
 * Then fetch book details from PostgreSQL for each ID
 */
