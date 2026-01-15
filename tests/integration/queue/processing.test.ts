import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/db/client.js';
import { issues } from '../../../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { seedTestCustomer, seedTestTransaction } from '../../helpers.js';
import { processIssue } from '../../../src/services/issueService.js';
import { issueRepository } from '../../../src/repositories/issueRepository.js';

describe('Issue Processing', () => {
  let customerId: string;
  let transactionId: string;

  beforeEach(async () => {
    const customer = await seedTestCustomer({ riskScore: 'low', successfulPayments: 10 });
    customerId = customer.id;
    const transaction = await seedTestTransaction(customerId);
    transactionId = transaction.id;
  });

  describe('Decision Engine - Decline', () => {
    it('should auto-resolve decline for low-risk customer with good history', async () => {
      // Create a pending issue
      const issue = await issueRepository.create({
        externalId: `iss_test_${Date.now()}`,
        type: 'decline',
        customerId,
        transactionId,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 1,
        },
        priority: 'normal',
      });

      // Process the issue
      const result = await processIssue(issue!.id, { workerId: 'test-worker' });

      expect(result.success).toBe(true);
      expect(result.status).toBe('resolved');
      expect(result.decision?.decision).toBe('retry_payment');
      expect(result.decision?.confidence).toBeGreaterThanOrEqual(0.8);

      // Verify database state
      const updated = await issueRepository.findById(issue!.id);
      expect(updated?.status).toBe('resolved');
      expect(updated?.automatedDecision).toBe('retry_payment');
      expect(updated?.finalResolution).toBe('payment_retry_scheduled');
    });
  });

  describe('Decision Engine - Escalation', () => {
    it('should escalate for high-risk customer', async () => {
      // Create a high-risk customer
      const highRiskCustomer = await seedTestCustomer({
        externalId: `cust_high_${Date.now()}`,
        riskScore: 'high',
        successfulPayments: 2,
      });
      const transaction = await seedTestTransaction(highRiskCustomer.id);

      const issue = await issueRepository.create({
        externalId: `iss_test_escalate_${Date.now()}`,
        type: 'decline',
        customerId: highRiskCustomer.id,
        transactionId: transaction.id,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 1,
        },
        priority: 'normal',
      });

      const result = await processIssue(issue!.id, { workerId: 'test-worker' });

      expect(result.success).toBe(true);
      expect(result.status).toBe('awaiting_review');
      expect(result.decision?.decision).toBe('escalate');

      const updated = await issueRepository.findById(issue!.id);
      expect(updated?.status).toBe('awaiting_review');
    });
  });

  describe('Non-retryable Errors', () => {
    it('should fail immediately for non-existent issue', async () => {
      const result = await processIssue('00000000-0000-0000-0000-000000000000', {
        workerId: 'test-worker',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Issue not found');
    });

    it('should skip processing for non-pending issues', async () => {
      // Create and immediately set to resolved
      const issue = await issueRepository.create({
        externalId: `iss_test_resolved_${Date.now()}`,
        type: 'decline',
        customerId,
        transactionId,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 0,
        },
        priority: 'normal',
      });

      await db.update(issues).set({ status: 'resolved' }).where(eq(issues.id, issue!.id));

      const result = await processIssue(issue!.id, { workerId: 'test-worker' });

      // Should return success but skip processing
      expect(result.success).toBe(true);
      expect(result.status).toBe('resolved');
      expect(result.decision).toBeUndefined();
    });
  });
});

describe('Decision Engine - All Issue Types', () => {
  let customerId: string;
  let transactionId: string;

  beforeEach(async () => {
    const customer = await seedTestCustomer({ riskScore: 'low' });
    customerId = customer.id;
    const transaction = await seedTestTransaction(customerId);
    transactionId = transaction.id;
  });

  it('should process missed_installment issue', async () => {
    const issue = await issueRepository.create({
      externalId: `iss_missed_${Date.now()}`,
      type: 'missed_installment',
      customerId,
      transactionId,
      details: {
        installment_number: 2,
        total_installments: 4,
        amount_due: 50,
        days_overdue: 5, // Short overdue, should approve retry
      },
      priority: 'normal',
    });

    const result = await processIssue(issue!.id, { workerId: 'test-worker' });

    expect(result.success).toBe(true);
    expect(result.decision?.decision).toBe('send_reminder');
  });

  it('should process refund_request issue within return window', async () => {
    const issue = await issueRepository.create({
      externalId: `iss_refund_${Date.now()}`,
      type: 'refund_request',
      customerId,
      transactionId,
      details: {
        reason: 'changed_mind',
        days_since_purchase: 3, // Within 7-day window
      },
      priority: 'normal',
    });

    const result = await processIssue(issue!.id, { workerId: 'test-worker' });

    expect(result.success).toBe(true);
    expect(result.decision?.decision).toBe('approve_refund');
    expect(result.decision?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('should reject refund_request outside return window', async () => {
    const issue = await issueRepository.create({
      externalId: `iss_refund_late_${Date.now()}`,
      type: 'refund_request',
      customerId,
      transactionId,
      details: {
        reason: 'changed_mind',
        days_since_purchase: 45, // Outside 30-day window
      },
      priority: 'normal',
    });

    const result = await processIssue(issue!.id, { workerId: 'test-worker' });

    expect(result.success).toBe(true);
    expect(result.decision?.decision).toBe('deny_refund');
  });
});
