import { Router } from 'express';
import { ProductsController } from '../controllers/products.controller';

const router = Router();
const controller = new ProductsController();

/**
 * @route GET /api/v1/products
 * @desc Get all products with pagination
 * @access Public
 */
router.get('/', controller.getAll);

/**
 * @route GET /api/v1/products/:id
 * @desc Get product by ID
 * @access Public
 */
router.get('/:id', controller.getById);

/**
 * @route GET /api/v1/products/category/:category
 * @desc Get products by category
 * @access Public
 */
router.get('/category/:category', controller.getByCategory);

/**
 * @route GET /api/v1/products/bestsellers
 * @desc Get bestseller products (from Redis leaderboard)
 * @access Public
 */
router.get('/bestsellers', controller.getBestsellers);

/**
 * @route POST /api/v1/products
 * @desc Create a new product
 * @access Admin
 */
router.post('/', controller.create);

/**
 * @route PUT /api/v1/products/:id
 * @desc Update a product
 * @access Admin
 */
router.put('/:id', controller.update);

/**
 * @route DELETE /api/v1/products/:id
 * @desc Delete a product
 * @access Admin
 */
router.delete('/:id', controller.delete);

export default router;
