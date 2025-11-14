import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';

const router = Router();
const controller = new SearchController();

/**
 * @route GET /api/v1/search?q=query
 * @desc Search products using Elasticsearch
 * @access Public
 */
router.get('/', controller.search);

/**
 * @route GET /api/v1/search/suggestions?q=query
 * @desc Get search suggestions (autocomplete)
 * @access Public
 */
router.get('/suggestions', controller.getSuggestions);

export default router;
