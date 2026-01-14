import { z } from 'zod';

// Issue type enum values
const issueTypeValues = ['decline', 'missed_installment', 'dispute', 'refund_request'] as const;
const issueStatusValues = ['pending', 'processing', 'awaiting_review', 'resolved', 'failed'] as const;
const priorityLevelValues = ['low', 'normal', 'high', 'critical'] as const;
const decisionTypeValues = ['approve_retry', 'approve_refund', 'reject', 'escalate'] as const;

// Details schemas for each issue type
const declineDetailsSchema = z.object({
  error_code: z.enum(['insufficient_funds', 'card_expired', 'card_declined']),
  auto_retry_count: z.number().int().min(0),
});

const missedInstallmentDetailsSchema = z.object({
  installment_number: z.number().int().min(1),
  total_installments: z.number().int().min(1),
  amount_due: z.number().positive(),
  days_overdue: z.number().int().min(0),
});

const disputeDetailsSchema = z.object({
  reason: z.enum(['item_not_received', 'unauthorized', 'product_issue']),
  days_since_purchase: z.number().int().min(0),
});

const refundRequestDetailsSchema = z.object({
  reason: z.enum(['changed_mind', 'defective', 'wrong_item']),
  days_since_purchase: z.number().int().min(0),
  partial_amount: z.number().positive().optional(),
});

// Create issue request schema
export const createIssueSchema = z.object({
  idempotency_key: z.string().max(100).optional(),
  type: z.enum(issueTypeValues),
  customer_id: z.string().min(1),
  transaction_id: z.string().min(1),
  details: z.union([
    declineDetailsSchema,
    missedInstallmentDetailsSchema,
    disputeDetailsSchema,
    refundRequestDetailsSchema,
  ]),
  priority: z.enum(priorityLevelValues).optional(),
});

export type CreateIssueRequest = z.infer<typeof createIssueSchema>;

// List issues query schema
export const listIssuesQuerySchema = z.object({
  status: z.enum(issueStatusValues).optional(),
  type: z.enum(issueTypeValues).optional(),
  customer_id: z.string().optional(),
  priority: z.enum(priorityLevelValues).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort_by: z.enum(['createdAt', 'priority', 'updatedAt']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
});

export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;

// Human review request schema
export const reviewIssueSchema = z.object({
  decision: z.enum(decisionTypeValues),
  reason: z.string().min(1).max(1000),
  reviewer_email: z.string().email(),
});

export type ReviewIssueRequest = z.infer<typeof reviewIssueSchema>;

// Issue ID param schema
export const issueIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type IssueIdParam = z.infer<typeof issueIdParamSchema>;
