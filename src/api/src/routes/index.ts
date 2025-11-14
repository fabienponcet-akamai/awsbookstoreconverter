import { Router } from 'express';
import productsRouter from './products.routes';
import cartRouter from './cart.routes';
import ordersRouter from './orders.routes';
import searchRouter from './search.routes';
import recommendationsRouter from './recommendations.routes';

const router = Router();

// API Routes
router.use('/products', productsRouter);
router.use('/cart', cartRouter);
router.use('/orders', ordersRouter);
router.use('/search', searchRouter);
router.use('/recommendations', recommendationsRouter);

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'Bookstore API - Cloud-Native with Knative & CloudNative-PG',
    version: process.env.API_VERSION || 'v1',
    architecture: {
      compute: 'Knative Serving (serverless, scale-to-zero)',
      databases: {
        main: 'CloudNative-PG (PostgreSQL)',
        search: 'CloudNative-PG with pg_trgm + ts_vector (replaces Elasticsearch)',
        graph: 'CloudNative-PG with Apache AGE (replaces Neptune)'
      }
    },
    endpoints: {
      products: '/api/v1/products',
      cart: '/api/v1/cart',
      orders: '/api/v1/orders',
      search: '/api/v1/search',
      recommendations: '/api/v1/recommendations'
    }
  });
});

export default router;
