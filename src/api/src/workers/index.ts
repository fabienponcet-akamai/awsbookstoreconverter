#!/usr/bin/env node
/**
 * Graph Outbox Worker - Entry Point
 *
 * This worker processes outbox events from the managed DBaaS
 * and syncs them to the CloudNativePG cluster with Apache AGE.
 *
 * Usage:
 *   NODE_ENV=production npm run worker:graph-outbox
 */

import { graphOutboxWorker } from './graph-outbox-worker';
import { createLogger } from '../utils/logger';

const logger = createLogger('GraphOutboxWorkerMain');

async function main() {
  logger.info('='.repeat(60));
  logger.info('Graph Outbox Worker Starting');
  logger.info('='.repeat(60));
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Managed DB: ${process.env.DATABASE_URL ? '✓' : '✗'}`);
  logger.info(`Graph DB: ${process.env.GRAPH_DATABASE_URL ? '✓' : '✗'}`);
  logger.info('='.repeat(60));

  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  if (!process.env.GRAPH_DATABASE_URL) {
    logger.error('GRAPH_DATABASE_URL environment variable is required');
    process.exit(1);
  }

  try {
    await graphOutboxWorker.start();
    logger.info('Worker started successfully');

    // Log stats periodically
    setInterval(async () => {
      try {
        const stats = await graphOutboxWorker.getStats();
        logger.info('Outbox Stats:', JSON.stringify(stats, null, 2));
      } catch (err) {
        logger.error('Failed to get stats:', err);
      }
    }, 60000); // Every minute

    // Run cleanup daily
    setInterval(async () => {
      try {
        await graphOutboxWorker.cleanup(7);
      } catch (err) {
        logger.error('Failed to cleanup:', err);
      }
    }, 24 * 60 * 60 * 1000); // Every 24 hours

  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Health check endpoint (optional, for Kubernetes probes)
if (process.env.ENABLE_HEALTH_CHECK === 'true') {
  const http = require('http');
  const port = process.env.HEALTH_CHECK_PORT || 8080;

  const server = http.createServer((req: any, res: any) => {
    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', worker: 'graph-outbox' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info(`Health check endpoint listening on port ${port}`);
  });
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
