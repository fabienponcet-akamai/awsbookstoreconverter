import { Router } from 'express';
import { CartController } from '../controllers/cart.controller';

const router = Router();
const controller = new CartController();

/**
 * @route GET /api/v1/cart/:userId
 * @desc Get user's cart
 * @access Private
 */
router.get('/:userId', controller.getCart);

/**
 * @route POST /api/v1/cart/:userId/items
 * @desc Add item to cart
 * @access Private
 */
router.post('/:userId/items', controller.addItem);

/**
 * @route PUT /api/v1/cart/:userId/items/:productId
 * @desc Update cart item quantity
 * @access Private
 */
router.put('/:userId/items/:productId', controller.updateItem);

/**
 * @route DELETE /api/v1/cart/:userId/items/:productId
 * @desc Remove item from cart
 * @access Private
 */
router.delete('/:userId/items/:productId', controller.removeItem);

/**
 * @route DELETE /api/v1/cart/:userId
 * @desc Clear cart
 * @access Private
 */
router.delete('/:userId', controller.clearCart);

export default router;
