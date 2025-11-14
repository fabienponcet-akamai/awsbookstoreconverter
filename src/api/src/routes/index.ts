import { Router } from 'express';
import productsRouter from './products.routes';
import cartRouter from './cart.routes';
import ordersRouter from './orders.routes';
import searchRouter from './search.routes';

const router = Router();

// API Routes
router.use('/products', productsRouter);
router.use('/cart', cartRouter);
router.use('/orders', ordersRouter);
router.use('/search', searchRouter);

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'Bookstore API',
    version: process.env.API_VERSION || 'v1',
    endpoints: {
      products: '/api/v1/products',
      cart: '/api/v1/cart',
      orders: '/api/v1/orders',
      search: '/api/v1/search'
    }
  });
});

export default router;
