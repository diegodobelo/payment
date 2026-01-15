import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { issueRepository } from '../repositories/issueRepository.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { transactionRepository } from '../repositories/transactionRepository.js';
import { statusHistoryRepository } from '../repositories/statusHistoryRepository.js';
import { decisionAnalyticsRepository } from '../repositories/decisionAnalyticsRepository.js';
import type { AuditContext } from '../repositories/customerRepository.js';
import {
  evaluate,
  shouldAutoResolve,
  getResolution,
  type UnifiedDecision,
} from './decisionEngineRouter.js';

// Lock constants
const LOCK_TTL_MS = 30_000; // 30 seconds
const LOCK_PREFIX = 'job:processing:';

/**
 * Result of processing an issue.
 */
export interface ProcessingResult {
  success: boolean;
  issueId: string;
  status: 'resolved' | 'awaiting_review' | 'failed';
  decision?: UnifiedDecision;
  error?: string;
}

/**
 * Errors that should not be retried.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Acquire a processing lock for an issue.
 * Returns true if lock was acquired, false if already locked.
 */
async function acquireLock(issueId: string, workerId: string): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${issueId}`;
  // SET NX (only if not exists) with expiry
  const result = await redis.set(lockKey, workerId, 'PX', LOCK_TTL_MS, 'NX');
  return result === 'OK';
}

/**
 * Release a processing lock.
 */
async function releaseLock(issueId: string, workerId: string): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${issueId}`;
  // Only delete if we own the lock
  const currentOwner = await redis.get(lockKey);
  if (currentOwner === workerId) {
    await redis.del(lockKey);
  }
}

/**
 * Process an issue through the decision engine.
 */
export async function processIssue(
  issueId: string,
  options?: {
    workerId?: string;
    requestId?: string;
  }
): Promise<ProcessingResult> {
  const workerId = options?.workerId ?? `worker-${process.pid}`;
  const log = logger.child({ issueId, workerId, requestId: options?.requestId });

  // Build audit context
  const audit: AuditContext = {
    actor: workerId,
  };
  if (options?.requestId !== undefined) {
    audit.requestId = options.requestId;
  }

  // Try to acquire lock
  const locked = await acquireLock(issueId, workerId);
  if (!locked) {
    log.warn('Issue already being processed by another worker');
    return {
      success: false,
      issueId,
      status: 'failed',
      error: 'Issue is already being processed',
    };
  }

  try {
    // Fetch the issue
    const issue = await issueRepository.findById(issueId);
    if (!issue) {
      throw new NonRetryableError(`Issue not found: ${issueId}`);
    }

    // Check if issue is in valid state for processing
    if (issue.status !== 'pending') {
      log.info({ currentStatus: issue.status }, 'Issue not in pending status, skipping');
      return {
        success: true,
        issueId,
        status: issue.status as 'resolved' | 'awaiting_review' | 'failed',
      };
    }

    // Update status to processing
    await issueRepository.updateStatus(issueId, 'processing', audit);
    await statusHistoryRepository.create({
      issueId,
      fromStatus: 'pending',
      toStatus: 'processing',
      changedBy: workerId,
      reason: 'Started processing',
    });

    log.info('Issue status updated to processing');

    // Fetch customer (without PII - we don't need it for decisions)
    const customer = await customerRepository.findByIdWithoutPii(issue.customerId);
    if (!customer) {
      throw new NonRetryableError(`Customer not found: ${issue.customerId}`);
    }

    // Fetch transaction (without PII - we don't need payment method for decisions)
    const transaction = await transactionRepository.findByIdWithoutPii(issue.transactionId);
    if (!transaction) {
      throw new NonRetryableError(`Transaction not found: ${issue.transactionId}`);
    }

    log.info({ issueType: issue.type }, 'Running decision engine');

    // Run the decision engine (now async to support AI mode)
    const decision = await evaluate(issue, customer, transaction);

    log.info(
      { decision: decision.decision, confidence: decision.confidence, source: decision.source },
      'Decision engine completed'
    );

    // Determine final status and resolution
    const autoResolve = shouldAutoResolve(decision);
    const finalStatus = autoResolve ? 'resolved' : 'awaiting_review';
    const finalResolution = autoResolve ? getResolution(decision) : null;

    // Update issue with decision
    const updateParams: Parameters<typeof issueRepository.update>[1] = {
      status: finalStatus,
      automatedDecision: decision.decision,
      automatedDecisionConfidence: decision.confidence.toFixed(2),
      automatedDecisionReason: decision.reason,
    };

    if (autoResolve && finalResolution !== null) {
      updateParams.finalResolution = finalResolution;
      updateParams.resolutionReason = decision.reason;
      updateParams.resolvedAt = new Date();
    }

    await issueRepository.update(issueId, updateParams, audit);

    // Record status transition
    await statusHistoryRepository.create({
      issueId,
      fromStatus: 'processing',
      toStatus: finalStatus,
      changedBy: workerId,
      reason: autoResolve
        ? `Auto-resolved: ${decision.reason}`
        : `Escalated for review: ${decision.reason}`,
      metadata: {
        decision: decision.decision,
        confidence: decision.confidence,
        autoResolved: autoResolve,
      },
    });

    // Record AI decision in analytics if it needs human review (AI mode only)
    if (!autoResolve && decision.source === 'ai') {
      const analyticsParams: Parameters<typeof decisionAnalyticsRepository.createAIDecision>[0] = {
        issueId,
        aiDecision: decision.aiRouting ?? 'human_review',
        aiAction: decision.decision,
        aiConfidence: decision.confidence * 100, // Convert to 0-100 scale
        aiReasoning: decision.reason,
      };
      if (decision.policyApplied) {
        analyticsParams.aiPolicyApplied = decision.policyApplied;
      }
      await decisionAnalyticsRepository.createAIDecision(analyticsParams);
    }

    log.info({ finalStatus, autoResolve }, 'Issue processing completed');

    return {
      success: true,
      issueId,
      status: finalStatus,
      decision,
    };
  } catch (error) {
    log.error({ err: error }, 'Error processing issue');

    // Determine if we should mark as failed or leave for retry
    if (error instanceof NonRetryableError) {
      // Only update status if the issue exists (not for "Issue not found" errors)
      const errorMessage = error.message;
      if (!errorMessage.includes('not found')) {
        await issueRepository.updateStatus(issueId, 'failed', audit);
        await statusHistoryRepository.create({
          issueId,
          fromStatus: 'processing',
          toStatus: 'failed',
          changedBy: workerId,
          reason: `Non-retryable error: ${errorMessage}`,
        });
      }

      return {
        success: false,
        issueId,
        status: 'failed',
        error: errorMessage,
      };
    }

    // Retryable error - update retry count but leave status as pending for retry
    const issue = await issueRepository.findById(issueId);
    if (issue) {
      await issueRepository.update(
        issueId,
        {
          status: 'pending', // Reset to pending for retry
          retryCount: issue.retryCount + 1,
          lastRetryAt: new Date(),
        },
        audit
      );
    }

    // Re-throw for queue to handle retry
    throw error;
  } finally {
    // Always release the lock
    await releaseLock(issueId, workerId);
  }
}
