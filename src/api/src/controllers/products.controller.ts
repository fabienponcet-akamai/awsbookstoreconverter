import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { createLogger } from '../utils/logger';

const logger = createLogger('ProductsController');

export class ProductsController {
  /**
   * Get all products with pagination
   */
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      // TODO: Implement with Prisma
      // const products = await prisma.product.findMany({
      //   skip: offset,
      //   take: limit,
      //   orderBy: { createdAt: 'desc' }
      // });

      logger.info(`Fetching products - page: ${page}, limit: ${limit}`);

      res.json({
        data: [],
        pagination: {
          page,
          limit,
          total: 0
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get product by ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // TODO: Implement with Prisma
      // const product = await prisma.product.findUnique({
      //   where: { id }
      // });

      logger.info(`Fetching product with id: ${id}`);

      res.json({
        data: null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get products by category
   */
  async getByCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { category } = req.params;

      // TODO: Implement with Prisma
      // const products = await prisma.product.findMany({
      //   where: { category }
      // });

      logger.info(`Fetching products in category: ${category}`);

      res.json({
        data: [],
        category
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get bestseller products from Redis leaderboard
   */
  async getBestsellers(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = parseInt(req.query.limit as string) || 20;

      // TODO: Implement with Redis
      // const bestsellers = await redisClient.zrevrange('bestsellers', 0, limit - 1);

      logger.info(`Fetching top ${limit} bestsellers`);

      res.json({
        data: []
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new product
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const productData = req.body;

      // TODO: Validate with Joi
      // TODO: Implement with Prisma
      // const product = await prisma.product.create({
      //   data: productData
      // });

      logger.info(`Creating new product`);

      res.status(201).json({
        data: productData
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a product
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const productData = req.body;

      // TODO: Implement with Prisma
      // const product = await prisma.product.update({
      //   where: { id },
      //   data: productData
      // });

      logger.info(`Updating product with id: ${id}`);

      res.json({
        data: productData
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a product
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // TODO: Implement with Prisma
      // await prisma.product.delete({
      //   where: { id }
      // });

      logger.info(`Deleting product with id: ${id}`);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
