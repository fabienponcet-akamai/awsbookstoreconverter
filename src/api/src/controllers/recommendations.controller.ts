import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { recommendationsService } from '../services/recommendations.service';
import { AppError } from '../middleware/errorHandler';

const logger = createLogger('RecommendationsController');

export class RecommendationsController {
  /**
   * Get personalized recommendations for a user
   * GET /api/v1/recommendations/:userId
   */
  async getUserRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      logger.info(`Getting recommendations for user: ${userId}`);

      const recommendations = await recommendationsService.getRecommendations(userId, limit);

      res.json({
        userId,
        recommendations,
        count: recommendations.length
      });
    } catch (error) {
      logger.error('Error getting user recommendations:', error);
      next(error);
    }
  }

  /**
   * Get similar users (collaborative filtering)
   * GET /api/v1/recommendations/:userId/similar-users
   */
  async getSimilarUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      logger.info(`Finding similar users for: ${userId}`);

      const similarUsers = await recommendationsService.findSimilarUsers(userId, limit);

      res.json({
        userId,
        similarUsers,
        count: similarUsers.length
      });
    } catch (error) {
      logger.error('Error finding similar users:', error);
      next(error);
    }
  }

  /**
   * Get similar books (users who bought this also bought...)
   * GET /api/v1/recommendations/books/:bookId/similar
   */
  async getSimilarBooks(req: Request, res: Response, next: NextFunction) {
    try {
      const { bookId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      logger.info(`Getting similar books for: ${bookId}`);

      const similarBooks = await recommendationsService.getSimilarBooks(bookId, limit);

      res.json({
        bookId,
        similarBooks,
        count: similarBooks.length
      });
    } catch (error) {
      logger.error('Error getting similar books:', error);
      next(error);
    }
  }

  /**
   * Get trending books
   * GET /api/v1/recommendations/trending
   */
  async getTrendingBooks(req: Request, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const limit = parseInt(req.query.limit as string) || 10;

      logger.info(`Getting trending books for last ${days} days`);

      const trendingBooks = await recommendationsService.getTrendingBooks(days, limit);

      res.json({
        days,
        trendingBooks,
        count: trendingBooks.length
      });
    } catch (error) {
      logger.error('Error getting trending books:', error);
      next(error);
    }
  }

  /**
   * Get user's purchase history from graph
   * GET /api/v1/recommendations/:userId/purchases
   */
  async getUserPurchases(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;

      logger.info(`Getting purchase history for user: ${userId}`);

      const purchases = await recommendationsService.getUserPurchases(userId);

      res.json({
        userId,
        purchases,
        count: purchases.length
      });
    } catch (error) {
      logger.error('Error getting user purchases:', error);
      next(error);
    }
  }
}
