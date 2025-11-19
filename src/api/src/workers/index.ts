#!/usr/bin/env node
/**
 * Unified Outbox Event Router - Entry Point
 *
 * This worker processes ALL outbox events from the managed DBaaS
 * and routes them to appropriate handlers for:
 * - OpenSearch (full-text search)
 * - CloudNativePG/AGE (graph-based recommendations)
 * - Redis (bestsellers cache)
 *
 * Benefits:
 * - Single worker instead of 3 separate workers
 * - One DB poll instead of 3 (reduces DB load by 66%)
 * - Centralized error handling and monitoring
 * - Easy to add new handlers
 *
 * Usage:
 *   NODE_ENV=production npm run worker:outbox-router
 */

import { outboxEventRouter } from './outbox-event-router';
import { SearchSyncHandler } from './handlers/search-sync.handler';
import { RecommendationsSyncHandler } from './handlers/recommendations-sync.handler';
import { BestsellersUpdateHandler } from './handlers/bestsellers-update.handler';
import { createLogger } from '../utils/logger';

const logger = createLogger('OutboxRouterMain');

async function main() {
  logger.info('='.repeat(60));
  logger.info('Unified Outbox Event Router Starting');
  logger.info('='.repeat(60));
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Managed DB: ${process.env.DATABASE_URL ? '✓' : '✗'}`);
  logger.info(`Graph DB: ${process.env.GRAPH_DATABASE_URL ? '✓' : '✗'}`);
  logger.info(`Poll Interval: ${process.env.POLL_INTERVAL_MS || 1000}ms`);
  logger.info('='.repeat(60));

  // Validate required environment variables
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  if (!process.env.GRAPH_DATABASE_URL) {
    logger.error('GRAPH_DATABASE_URL environment variable is required');
    process.exit(1);
  }

  try {
    // Register all handlers
    logger.info('📝 Registering event handlers...');

    outboxEventRouter.registerHandler(new SearchSyncHandler());
    outboxEventRouter.registerHandler(new RecommendationsSyncHandler());
    outboxEventRouter.registerHandler(new BestsellersUpdateHandler());

    logger.info('');

    // Display router statistics
    const stats = await outboxEventRouter.getStats();
    logger.info('📊 Router Configuration:');
    logger.info(`   Total handlers: ${stats.handlers.total}`);
    logger.info('   Event routing:');
    for (const [event, handlers] of Object.entries(stats.handlers.by_event) as [string, string[]][]) {
      logger.info(`     - ${event} → ${handlers.join(', ')}`);
    }
    logger.info('');

    // Start the router
    await outboxEventRouter.start();
    logger.info('✅ Router started successfully');
    logger.info('');

    // Log stats periodically (every minute)
    setInterval(async () => {
      try {
        const stats = await outboxEventRouter.getStats();
        logger.info('📊 Outbox Stats:');
        for (const event of stats.events) {
          if (event.pending_count > 0 || event.failed_count > 0) {
            logger.info(`   ${event.event_type}:`);
            logger.info(`     Pending: ${event.pending_count}`);
            logger.info(`     Processed: ${event.processed_count}`);
            if (event.failed_count > 0) {
              logger.warn(`     Failed: ${event.failed_count}`);
            }
            if (event.retried_count > 0) {
              logger.info(`     Retried: ${event.retried_count}`);
            }
          }
        }
      } catch (err) {
        logger.error('Failed to get stats:', err);
      }
    }, 60000); // Every minute

    // Run cleanup daily at 3 AM
    const scheduleCleanup = () => {
      const now = new Date();
      const tomorrow3AM = new Date(now);
      tomorrow3AM.setDate(tomorrow3AM.getDate() + 1);
      tomorrow3AM.setHours(3, 0, 0, 0);

      const msUntil3AM = tomorrow3AM.getTime() - now.getTime();

      setTimeout(async () => {
        try {
          logger.info('🧹 Running scheduled cleanup...');
          await outboxEventRouter.cleanup(7);
          scheduleCleanup(); // Schedule next cleanup
        } catch (err) {
          logger.error('Failed to cleanup:', err);
          scheduleCleanup(); // Try again tomorrow
        }
      }, msUntil3AM);

      logger.info(`Next cleanup scheduled for: ${tomorrow3AM.toISOString()}`);
    };

    scheduleCleanup();

  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Health check endpoint (for Kubernetes probes)
if (process.env.ENABLE_HEALTH_CHECK === 'true') {
  const http = require('http');
  const port = process.env.HEALTH_CHECK_PORT || 8080;

  const server = http.createServer(async (req: any, res: any) => {
    if (req.url === '/health' || req.url === '/healthz') {
      try {
        // Could add more health checks here (DB connectivity, etc.)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          worker: 'outbox-event-router',
          uptime: process.uptime()
        }));
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    } else if (req.url === '/ready' || req.url === '/readyz') {
      // Readiness check
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready' }));
    } else if (req.url === '/stats') {
      // Stats endpoint
      try {
        const stats = await outboxEventRouter.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info(`Health check endpoint listening on port ${port}`);
    logger.info(`  GET /health   - Health check`);
    logger.info(`  GET /ready    - Readiness check`);
    logger.info(`  GET /stats    - Router statistics`);
  });
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
