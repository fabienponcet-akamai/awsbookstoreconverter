import { Router } from 'express';
import { RecommendationsController } from '../controllers/recommendations.controller';

const router = Router();
const controller = new RecommendationsController();

/**
 * @route GET /api/v1/recommendations/trending
 * @desc Get trending books (most purchased recently)
 * @access Public
 * @query days - Number of days to look back (default: 7)
 * @query limit - Number of results (default: 10)
 */
router.get('/trending', controller.getTrendingBooks);

/**
 * @route GET /api/v1/recommendations/books/:bookId/similar
 * @desc Get similar books (users who bought this also bought...)
 * @access Public
 */
router.get('/books/:bookId/similar', controller.getSimilarBooks);

/**
 * @route GET /api/v1/recommendations/:userId
 * @desc Get personalized recommendations for a user
 * @access Private
 */
router.get('/:userId', controller.getUserRecommendations);

/**
 * @route GET /api/v1/recommendations/:userId/similar-users
 * @desc Find users with similar purchase patterns
 * @access Private
 */
router.get('/:userId/similar-users', controller.getSimilarUsers);

/**
 * @route GET /api/v1/recommendations/:userId/purchases
 * @desc Get user's purchase history from graph database
 * @access Private
 */
router.get('/:userId/purchases', controller.getUserPurchases);

export default router;
