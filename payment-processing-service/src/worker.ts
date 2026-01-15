import { logger } from './lib/logger.js';
import { closeRedis, testRedisConnection } from './lib/redis.js';
import { closeDatabase, testConnection } from './db/client.js';
import { closeQueue } from './queue/queueManager.js';
import {
  closeMaintenanceQueue,
  registerScheduledJobs,
} from './queue/maintenanceQueue.js';
import { createWorker, type Worker } from './queue/workers/issueProcessor.worker.js';
import { createMaintenanceWorker } from './queue/workers/maintenance.worker.js';

let worker: Worker | null = null;
let maintenanceWorker: Worker | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler.
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal');

  const shutdownTimeout = 30_000; // 30 seconds
  const startTime = Date.now();

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Shutdown timeout reached'));
    }, shutdownTimeout);
  });

  try {
    await Promise.race([
      (async () => {
        // Pause all workers
        if (worker) {
          await worker.pause();
          logger.info('Issue worker paused');
        }
        if (maintenanceWorker) {
          await maintenanceWorker.pause();
          logger.info('Maintenance worker paused');
        }

        // Wait for active jobs to complete
        logger.info('Waiting for active jobs to complete...');
        while (
          (worker && (await worker.isRunning())) ||
          (maintenanceWorker && (await maintenanceWorker.isRunning()))
        ) {
          if (Date.now() - startTime > shutdownTimeout - 5000) {
            logger.warn('Approaching timeout, forcing worker close');
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Close workers
        if (worker) {
          await worker.close();
          logger.info('Issue worker closed');
        }
        if (maintenanceWorker) {
          await maintenanceWorker.close();
          logger.info('Maintenance worker closed');
        }

        // Close queues
        await closeQueue();
        await closeMaintenanceQueue();
        logger.info('Queues closed');

        // 5. Close database connections
        await closeDatabase();
        logger.info('Database connection closed');

        // 6. Close Redis connection
        await closeRedis();
        logger.info('Redis connection closed');

        logger.info(
          { durationMs: Date.now() - startTime },
          'Graceful shutdown complete'
        );
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    logger.warn({ error }, 'Shutdown timeout reached, forcing exit');
  }

  process.exit(0);
}

/**
 * Main entry point for the worker process.
 */
async function main(): Promise<void> {
  try {
    logger.info('Starting worker process...');

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database');
      process.exit(1);
    }
    logger.info('Database connection successful');

    // Test Redis connection
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      logger.error('Failed to connect to Redis');
      process.exit(1);
    }
    logger.info('Redis connection successful');

    // Create and start the issue processor worker
    worker = createWorker();
    logger.info('Issue processor worker started');

    // Create and start the maintenance worker
    maintenanceWorker = createMaintenanceWorker();
    logger.info('Maintenance worker started');

    // Register scheduled maintenance jobs
    await registerScheduledJobs();

    logger.info('All workers started successfully');

    // Setup graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error({ error }, 'Uncaught exception');
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({ reason }, 'Unhandled rejection');
      gracefulShutdown('unhandledRejection');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start worker');
    process.exit(1);
  }
}

main();
