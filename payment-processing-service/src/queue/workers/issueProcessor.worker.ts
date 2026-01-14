import { Worker, Job } from 'bullmq';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { processIssue, NonRetryableError } from '../../services/issueService.js';
import type { ProcessIssueJobData } from '../queueManager.js';

const QUEUE_NAME = 'issue-processing';

// Connection options for BullMQ
const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
};

/**
 * Process an issue job.
 */
async function processJob(job: Job<ProcessIssueJobData>): Promise<void> {
  const { issueId, requestId } = job.data;
  const workerId = `worker-${process.pid}-${job.id}`;

  const log = logger.child({
    jobId: job.id,
    issueId,
    requestId,
    workerId,
    attempt: job.attemptsMade + 1,
  });

  log.info('Starting job processing');

  try {
    // Build options, only including requestId if defined
    const processOptions: { workerId: string; requestId?: string } = { workerId };
    if (requestId !== undefined) {
      processOptions.requestId = requestId;
    }

    const result = await processIssue(issueId, processOptions);

    if (result.success) {
      log.info(
        { status: result.status, decision: result.decision?.decision },
        'Job completed successfully'
      );
    } else {
      log.warn({ error: result.error }, 'Job completed with failure');
      // Throw to trigger retry if appropriate
      throw new Error(result.error);
    }
  } catch (error) {
    log.error({ error }, 'Job processing error');

    // Non-retryable errors should not be retried
    if (error instanceof NonRetryableError) {
      // Mark job as failed without retry by throwing UnrecoverableError
      const BullMQError = await import('bullmq').then(m => m.UnrecoverableError);
      throw new BullMQError(error.message);
    }

    // Other errors will be retried by BullMQ
    throw error;
  }
}

/**
 * Create and start the issue processor worker.
 */
export function createWorker(): Worker<ProcessIssueJobData> {
  const worker = new Worker<ProcessIssueJobData>(QUEUE_NAME, processJob, {
    connection,
    concurrency: config.queue.concurrency,
    limiter: {
      max: config.queue.concurrency * 2,
      duration: 1000,
    },
  });

  worker.on('ready', () => {
    logger.info({ concurrency: config.queue.concurrency }, 'Worker ready');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, issueId: job.data.issueId }, 'Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, issueId: job?.data.issueId, error: error.message },
      'Job failed'
    );
  });

  worker.on('error', (error) => {
    logger.error({ error }, 'Worker error');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Job stalled');
  });

  return worker;
}

export { Worker };
