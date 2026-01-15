import { Queue, QueueEvents } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const QUEUE_NAME = 'issue-processing';

// Connection options for BullMQ
const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
};

// Job data interface
export interface ProcessIssueJobData {
  issueId: string;
  requestId?: string;
}

// Create the queue
export const issueQueue = new Queue<ProcessIssueJobData>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: config.queue.backoffDelayMs,
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs
      age: 24 * 60 * 60, // Keep for 24 hours
    },
    removeOnFail: {
      count: 5000, // Keep last 5000 failed jobs for debugging
    },
  },
});

// Queue events for monitoring
const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

queueEvents.on('completed', ({ jobId }) => {
  logger.info({ jobId }, 'Job completed');
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, 'Job failed');
});

queueEvents.on('stalled', ({ jobId }) => {
  logger.warn({ jobId }, 'Job stalled');
});

/**
 * Add an issue to the processing queue.
 */
export async function enqueueIssue(
  issueId: string,
  options?: {
    priority?: number;
    requestId?: string;
  }
): Promise<string> {
  // Build job data, only including requestId if provided
  const jobData: ProcessIssueJobData = { issueId };
  if (options?.requestId !== undefined) {
    jobData.requestId = options.requestId;
  }

  // Build job options, only including priority if provided
  const jobOptions: { jobId: string; priority?: number } = {
    jobId: `issue-${issueId}`, // Prevent duplicate jobs for same issue
  };
  if (options?.priority !== undefined) {
    jobOptions.priority = options.priority;
  }

  const job = await issueQueue.add('process-issue', jobData, jobOptions);

  logger.info({ issueId, jobId: job.id }, 'Issue enqueued for processing');

  return job.id ?? issueId;
}

/**
 * Close the queue gracefully.
 */
export async function closeQueue(): Promise<void> {
  await queueEvents.close();
  await issueQueue.close();
  logger.info('Queue closed');
}
