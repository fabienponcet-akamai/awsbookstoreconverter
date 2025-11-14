import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { createLogger } from '../utils/logger';
import { Pool } from 'pg';

const logger = createLogger('SearchController');

// Create a connection pool for the search database
const searchPool = new Pool({
  connectionString: process.env.SEARCH_DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export class SearchController {
  /**
   * Search products using PostgreSQL full-text search
   */
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      if (!query) {
        throw new AppError('Search query is required', 400);
      }

      logger.info(`Searching products with query: ${query}, page: ${page}`);

      // Use the PostgreSQL full-text search function
      const result = await searchPool.query(
        `SELECT * FROM search_products($1, $2, $3)`,
        [query, limit, offset]
      );

      // Get total count for pagination
      const countResult = await searchPool.query(
        `SELECT COUNT(*) as total
         FROM product_search
         WHERE search_vector @@ websearch_to_tsquery('english', $1)
            OR title % $1
            OR author % $1`,
        [query]
      );

      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      res.json({
        data: result.rows.map(row => ({
          id: row.id,
          title: row.title,
          author: row.author,
          description: row.description,
          category: row.category,
          isbn: row.isbn,
          relevance: {
            rank: parseFloat(row.rank),
            similarity: parseFloat(row.similarity)
          }
        })),
        query,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Search error:', error);
      next(error);
    }
  }

  /**
   * Get search suggestions (autocomplete) using PostgreSQL
   */
  async getSuggestions(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 5;

      if (!query || query.length < 2) {
        return res.json({ data: [] });
      }

      logger.info(`Getting suggestions for query: ${query}`);

      // Use the PostgreSQL autocomplete function
      const result = await searchPool.query(
        `SELECT * FROM autocomplete_products($1, $2)`,
        [query, limit]
      );

      res.json({
        data: result.rows.map(row => ({
          suggestion: row.suggestion,
          type: row.type
        }))
      });
    } catch (error) {
      logger.error('Autocomplete error:', error);
      next(error);
    }
  }

  /**
   * Search by category with full-text within category
   */
  async searchByCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { category } = req.params;
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      logger.info(`Searching in category: ${category}, query: ${query || 'all'}`);

      let result;
      let countResult;

      if (query) {
        // Search within category
        result = await searchPool.query(
          `SELECT
             id, title, author, description, category, isbn,
             ts_rank(search_vector, websearch_to_tsquery('english', $1)) as rank
           FROM product_search
           WHERE category = $2
             AND search_vector @@ websearch_to_tsquery('english', $1)
           ORDER BY rank DESC
           LIMIT $3 OFFSET $4`,
          [query, category, limit, offset]
        );

        countResult = await searchPool.query(
          `SELECT COUNT(*) as total
           FROM product_search
           WHERE category = $1
             AND search_vector @@ websearch_to_tsquery('english', $2)`,
          [category, query]
        );
      } else {
        // List all in category
        result = await searchPool.query(
          `SELECT id, title, author, description, category, isbn
           FROM product_search
           WHERE category = $1
           ORDER BY updated_at DESC
           LIMIT $2 OFFSET $3`,
          [category, limit, offset]
        );

        countResult = await searchPool.query(
          `SELECT COUNT(*) as total
           FROM product_search
           WHERE category = $1`,
          [category]
        );
      }

      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      res.json({
        data: result.rows,
        category,
        query: query || null,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Category search error:', error);
      next(error);
    }
  }

  /**
   * Fuzzy search for typo tolerance
   */
  async fuzzySearch(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const threshold = parseFloat(req.query.threshold as string) || 0.3;
      const limit = parseInt(req.query.limit as string) || 20;

      if (!query) {
        throw new AppError('Search query is required', 400);
      }

      logger.info(`Fuzzy search with query: ${query}, threshold: ${threshold}`);

      // Fuzzy search using trigram similarity
      const result = await searchPool.query(
        `SELECT
           id, title, author, description, category, isbn,
           GREATEST(
             similarity(title, $1),
             similarity(author, $1)
           ) as similarity
         FROM product_search
         WHERE title % $1 OR author % $1
         ORDER BY similarity DESC
         LIMIT $2`,
        [query, limit]
      );

      res.json({
        data: result.rows.filter(row => parseFloat(row.similarity) >= threshold),
        query,
        fuzzy: true,
        threshold
      });
    } catch (error) {
      logger.error('Fuzzy search error:', error);
      next(error);
    }
  }
}
