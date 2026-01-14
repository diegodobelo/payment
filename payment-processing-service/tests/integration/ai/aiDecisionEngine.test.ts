import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setMockAIResponse, resetMockAIResponse } from '../../setup.js';
import {
  createMockAIResponse,
  createMockAIResponseRaw,
  createMockAIError,
  seedTestCustomer,
  seedTestTransaction,
} from '../../helpers.js';
import { issueRepository } from '../../../src/repositories/issueRepository.js';
import { evaluateWithAI } from '../../../src/services/aiDecisionEngine.js';
import { shouldAutoResolve } from '../../../src/services/decisionEngineRouter.js';
import type { Issue, Customer, Transaction } from '../../../src/db/schema/index.js';
import type {
  IssueDetails,
  DeclineDetails,
  RefundRequestDetails,
  DisputeDetails,
  MissedInstallmentDetails,
} from '../../../src/db/schema/issues.js';

describe('AI Decision Engine', () => {
  let customerId: string;
  let transactionId: string;
  let testCustomer: Customer;
  let testTransaction: Transaction;

  beforeEach(async () => {
    // Seed test data
    const customer = await seedTestCustomer({ riskScore: 'low', successfulPayments: 10 });
    customerId = customer.id;
    testCustomer = customer as unknown as Customer;
    const transaction = await seedTestTransaction(customerId);
    transactionId = transaction.id;
    testTransaction = transaction as unknown as Transaction;
  });

  afterEach(() => {
    // Reset mock to default after each test
    resetMockAIResponse();
  });

  // Helper to create a test issue
  async function createTestIssue(type: 'decline' | 'refund_request' | 'dispute' | 'missed_installment' = 'decline') {
    const details: IssueDetails = type === 'decline'
      ? { error_code: 'insufficient_funds', auto_retry_count: 1 } as DeclineDetails
      : type === 'refund_request'
      ? { reason: 'changed_mind', days_since_purchase: 5 } as RefundRequestDetails
      : type === 'dispute'
      ? { reason: 'item_not_received', days_since_purchase: 10 } as DisputeDetails
      : { installment_number: 2, total_installments: 4, amount_due: 50, days_overdue: 5 } as MissedInstallmentDetails;

    const issue = await issueRepository.create({
      externalId: `iss_ai_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      customerId,
      transactionId,
      details,
      priority: 'normal',
    });
    return issue as Issue;
  }

  describe('AI Response Parsing (evaluateWithAI)', () => {
    it('should parse auto_resolve decision correctly', async () => {
      setMockAIResponse(createMockAIResponse({
        decision: 'auto_resolve',
        action: 'approve_retry',
        confidence: 95,
        reasoning: 'Test reasoning',
        policyApplied: 'test_policy',
      }));

      const issue = await createTestIssue();
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.decision).toBe('auto_resolve');
      expect(result.action).toBe('approve_retry');
      expect(result.confidence).toBe(95);
      expect(result.reasoning).toBe('Test reasoning');
      expect(result.policyApplied).toBe('test_policy');
    });

    it('should parse human_review decision correctly', async () => {
      setMockAIResponse(createMockAIResponse({
        decision: 'human_review',
        action: 'approve_refund',
        confidence: 75,
      }));

      const issue = await createTestIssue();
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.decision).toBe('human_review');
      expect(result.action).toBe('approve_refund');
      expect(result.confidence).toBe(75);
    });

    it('should parse escalate decision correctly', async () => {
      setMockAIResponse(createMockAIResponse({
        decision: 'escalate',
        action: 'escalate',
        confidence: 40,
      }));

      const issue = await createTestIssue();
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.decision).toBe('escalate');
      expect(result.action).toBe('escalate');
      expect(result.confidence).toBe(40);
    });

    it('should handle approve_refund action', async () => {
      setMockAIResponse(createMockAIResponse({
        decision: 'auto_resolve',
        action: 'approve_refund',
        confidence: 90,
      }));

      const issue = await createTestIssue('refund_request');
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.action).toBe('approve_refund');
    });

    it('should handle reject action', async () => {
      setMockAIResponse(createMockAIResponse({
        decision: 'auto_resolve',
        action: 'reject',
        confidence: 92,
      }));

      const issue = await createTestIssue();
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.action).toBe('reject');
    });

    it('should handle JSON embedded in text', async () => {
      const jsonWithText = `Here is my analysis:

        {"decision":"auto_resolve","action":"approve_retry","confidence":88,"reasoning":"Looks good","policyApplied":"test"}

        Let me know if you need more details.`;

      setMockAIResponse(createMockAIResponseRaw(jsonWithText));

      const issue = await createTestIssue();
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.decision).toBe('auto_resolve');
      expect(result.action).toBe('approve_retry');
      expect(result.confidence).toBe(88);
    });

    it('should preserve policyApplied field', async () => {
      setMockAIResponse(createMockAIResponse({
        decision: 'human_review',
        action: 'approve_retry',
        confidence: 70,
        policyApplied: 'decline-policy-v2',
      }));

      const issue = await createTestIssue();
      const result = await evaluateWithAI(issue, testCustomer, testTransaction);

      expect(result.policyApplied).toBe('decline-policy-v2');
    });
  });

  describe('AI Response Validation Errors', () => {
    it('should throw error when response missing decision field', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        action: 'approve_retry',
        confidence: 85,
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Missing required fields');
    });

    it('should throw error when response missing action field', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        decision: 'auto_resolve',
        confidence: 85,
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Missing required fields');
    });

    it('should throw error when response missing confidence field', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        decision: 'auto_resolve',
        action: 'approve_retry',
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Missing required fields');
    });

    it('should throw error for invalid decision value', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        decision: 'invalid_decision',
        action: 'approve_retry',
        confidence: 85,
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Invalid decision value');
    });

    it('should throw error for invalid action value', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        decision: 'auto_resolve',
        action: 'invalid_action',
        confidence: 85,
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Invalid action value');
    });

    it('should throw error for confidence < 0', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        decision: 'auto_resolve',
        action: 'approve_retry',
        confidence: -10,
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Confidence must be 0-100');
    });

    it('should throw error for confidence > 100', async () => {
      setMockAIResponse(createMockAIResponseRaw(JSON.stringify({
        decision: 'auto_resolve',
        action: 'approve_retry',
        confidence: 150,
      })));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('Confidence must be 0-100');
    });

    it('should throw error on malformed JSON', async () => {
      setMockAIResponse(createMockAIResponseRaw('This is not valid JSON at all'));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('No JSON found');
    });

    it('should throw error when no JSON found in response', async () => {
      setMockAIResponse(createMockAIResponseRaw('I cannot process this request. Please try again later.'));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('No JSON found');
    });
  });

  describe('SDK Error Handling', () => {
    it('should propagate SDK errors', async () => {
      setMockAIResponse(createMockAIError('API rate limit exceeded'));

      const issue = await createTestIssue();
      await expect(evaluateWithAI(issue, testCustomer, testTransaction))
        .rejects.toThrow('API rate limit exceeded');
    });
  });

  describe('Decision Routing (shouldAutoResolve)', () => {
    it('should auto-resolve for auto_resolve routing with high confidence', () => {
      const decision = {
        decision: 'approve_retry' as const,
        confidence: 0.95,
        reason: 'test',
        source: 'ai' as const,
        aiRouting: 'auto_resolve' as const,
      };

      expect(shouldAutoResolve(decision)).toBe(true);
    });

    it('should not auto-resolve for human_review routing', () => {
      const decision = {
        decision: 'approve_retry' as const,
        confidence: 0.95,
        reason: 'test',
        source: 'ai' as const,
        aiRouting: 'human_review' as const,
      };

      expect(shouldAutoResolve(decision)).toBe(false);
    });

    it('should not auto-resolve for escalate routing', () => {
      const decision = {
        decision: 'escalate' as const,
        confidence: 0.5,
        reason: 'test',
        source: 'ai' as const,
        aiRouting: 'escalate' as const,
      };

      expect(shouldAutoResolve(decision)).toBe(false);
    });
  });
});
