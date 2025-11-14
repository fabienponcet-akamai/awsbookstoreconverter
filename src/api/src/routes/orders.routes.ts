import { Router } from 'express';
import { OrdersController } from '../controllers/orders.controller';

const router = Router();
const controller = new OrdersController();

/**
 * @route POST /api/v1/orders
 * @desc Create a new order (checkout)
 * @access Private
 */
router.post('/', controller.createOrder);

/**
 * @route GET /api/v1/orders/:userId
 * @desc Get user's order history
 * @access Private
 */
router.get('/:userId', controller.getUserOrders);

/**
 * @route GET /api/v1/orders/:userId/:orderId
 * @desc Get specific order details
 * @access Private
 */
router.get('/:userId/:orderId', controller.getOrderById);

export default router;
