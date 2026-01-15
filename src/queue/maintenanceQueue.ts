import { Queue, QueueEvents } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const QUEUE_NAME = 'maintenance';

// Connection options for BullMQ
const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
};

// Job types
export type MaintenanceJobType = 'archive-issues' | 'create-partition' | 'purge-audit-logs';

export interface MaintenanceJobData {
  type: MaintenanceJobType;
}

// Create the queue
export const maintenanceQueue = new Queue<MaintenanceJobData>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 7 * 24 * 60 * 60, // Keep for 7 days
    },
    removeOnFail: {
      count: 100,
    },
  },
});

// Queue events for monitoring
const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

queueEvents.on('completed', ({ jobId }) => {
  logger.info({ jobId, queue: QUEUE_NAME }, 'Maintenance job completed');
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason, queue: QUEUE_NAME }, 'Maintenance job failed');
});

/**
 * Register scheduled maintenance jobs.
 * Should be called once at worker startup.
 */
export async function registerScheduledJobs(): Promise<void> {
  if (!config.maintenance.enabled) {
    logger.info('Maintenance jobs disabled');
    return;
  }

  const log = logger.child({ component: 'maintenanceScheduler' });

  // Remove any existing repeatable jobs first to avoid duplicates
  const existingJobs = await maintenanceQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await maintenanceQueue.removeRepeatableByKey(job.key);
    log.debug({ jobKey: job.key }, 'Removed existing repeatable job');
  }

  // Schedule archive job (daily by default)
  await maintenanceQueue.add(
    'archive-issues',
    { type: 'archive-issues' },
    {
      repeat: {
        pattern: config.maintenance.archival.schedule,
      },
      jobId: 'scheduled-archive',
    }
  );
  log.info(
    { schedule: config.maintenance.archival.schedule },
    'Scheduled archive-issues job'
  );

  // Schedule partition creation (monthly by default)
  await maintenanceQueue.add(
    'create-partition',
    { type: 'create-partition' },
    {
      repeat: {
        pattern: config.maintenance.partition.schedule,
      },
      jobId: 'scheduled-partition',
    }
  );
  log.info(
    { schedule: config.maintenance.partition.schedule },
    'Scheduled create-partition job'
  );

  // Schedule audit log purge (daily by default)
  await maintenanceQueue.add(
    'purge-audit-logs',
    { type: 'purge-audit-logs' },
    {
      repeat: {
        pattern: config.maintenance.auditLogs.schedule,
      },
      jobId: 'scheduled-audit-purge',
    }
  );
  log.info(
    { schedule: config.maintenance.auditLogs.schedule },
    'Scheduled purge-audit-logs job'
  );

  log.info('Maintenance jobs scheduled successfully');
}

/**
 * Trigger a maintenance job immediately (for manual runs).
 */
export async function triggerMaintenanceJob(
  type: MaintenanceJobType
): Promise<string> {
  const job = await maintenanceQueue.add(
    type,
    { type },
    { jobId: `manual-${type}-${Date.now()}` }
  );

  logger.info({ type, jobId: job.id }, 'Manual maintenance job enqueued');
  return job.id ?? type;
}

/**
 * Close the maintenance queue gracefully.
 */
export async function closeMaintenanceQueue(): Promise<void> {
  await queueEvents.close();
  await maintenanceQueue.close();
  logger.info('Maintenance queue closed');
}
