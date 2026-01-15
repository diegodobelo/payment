import { Worker, Job } from 'bullmq';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import {
  archiveResolvedIssues,
  purgeOldArchives,
} from '../../services/archivalService.js';
import { createFuturePartitions } from '../../services/partitionService.js';
import type { MaintenanceJobData } from '../maintenanceQueue.js';

const QUEUE_NAME = 'maintenance';

// Connection options for BullMQ
const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
};

/**
 * Process a maintenance job.
 */
async function processJob(job: Job<MaintenanceJobData>): Promise<void> {
  const { type } = job.data;

  const log = logger.child({
    jobId: job.id,
    jobType: type,
    component: 'maintenanceWorker',
  });

  log.info('Starting maintenance job');

  try {
    switch (type) {
      case 'archive-issues': {
        // Archive resolved issues
        const archiveResult = await archiveResolvedIssues(
          config.maintenance.archival.olderThanDays
        );
        log.info(
          { archivedCount: archiveResult.archivedCount },
          'Archival completed'
        );

        // Purge old archives beyond retention period
        const purgeResult = await purgeOldArchives(
          config.maintenance.archival.purgeAfterDays
        );
        log.info(
          { purgedCount: purgeResult.purgedCount },
          'Archive purge completed'
        );

        if (archiveResult.errors.length > 0 || purgeResult.errors.length > 0) {
          throw new Error(
            `Maintenance completed with errors: ${[
              ...archiveResult.errors,
              ...purgeResult.errors,
            ].join(', ')}`
          );
        }
        break;
      }

      case 'create-partition': {
        // Create partitions for next 3 months
        const result = await createFuturePartitions(3);
        log.info(
          { partitionsCreated: result.created, skipped: result.skipped },
          'Partition creation completed'
        );

        if (result.errors.length > 0) {
          throw new Error(
            `Partition creation completed with errors: ${result.errors.join(', ')}`
          );
        }
        break;
      }

      default:
        throw new Error(`Unknown maintenance job type: ${type}`);
    }

    log.info('Maintenance job completed successfully');
  } catch (error) {
    log.error({ err: error }, 'Maintenance job failed');
    throw error;
  }
}

/**
 * Create and start the maintenance worker.
 */
export function createMaintenanceWorker(): Worker<MaintenanceJobData> {
  const worker = new Worker<MaintenanceJobData>(QUEUE_NAME, processJob, {
    connection,
    concurrency: 1, // Run maintenance jobs sequentially
  });

  worker.on('ready', () => {
    logger.info({ queue: QUEUE_NAME }, 'Maintenance worker ready');
  });

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, type: job.data.type },
      'Maintenance job completed'
    );
  });

  worker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, type: job?.data.type, error: error.message },
      'Maintenance job failed'
    );
  });

  worker.on('error', (error) => {
    logger.error({ err: error, queue: QUEUE_NAME }, 'Maintenance worker error');
  });

  return worker;
}
