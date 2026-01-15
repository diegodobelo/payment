import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import {
  issueTypeEnum,
  issueStatusEnum,
  priorityLevelEnum,
  decisionTypeEnum,
} from './enums';
import { customers } from './customers';
import { transactions } from './transactions';

// Details JSONB types by issue type
export interface DeclineDetails {
  error_code: 'insufficient_funds' | 'card_expired' | 'card_declined';
  auto_retry_count: number;
}

export interface MissedInstallmentDetails {
  installment_number: number;
  total_installments: number;
  amount_due: number;
  days_overdue: number;
}

export interface DisputeDetails {
  reason: 'item_not_received' | 'unauthorized' | 'product_issue';
  days_since_purchase: number;
}

export interface RefundRequestDetails {
  reason: 'changed_mind' | 'defective' | 'wrong_item';
  days_since_purchase: number;
  partial_amount?: number;
}

export type IssueDetails =
  | DeclineDetails
  | MissedInstallmentDetails
  | DisputeDetails
  | RefundRequestDetails;

export const issues = pgTable(
  'issues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalId: varchar('external_id', { length: 50 }).notNull().unique(),

    // Core fields
    type: issueTypeEnum('type').notNull(),
    status: issueStatusEnum('status').notNull().default('pending'),
    priority: priorityLevelEnum('priority').notNull().default('normal'),

    // Relationships
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),

    // Type-specific details
    details: jsonb('details').$type<IssueDetails>().notNull(),

    // Processing state
    retryCount: integer('retry_count').notNull().default(0),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),

    // Automated decision
    automatedDecision: decisionTypeEnum('automated_decision'),
    automatedDecisionConfidence: decimal('automated_decision_confidence', {
      precision: 3,
      scale: 2,
    }),
    automatedDecisionReason: text('automated_decision_reason'),

    // Human review
    humanDecision: decisionTypeEnum('human_decision'),
    humanDecisionReason: text('human_decision_reason'),
    humanReviewerEmail: varchar('human_reviewer_email', { length: 255 }),
    humanReviewedAt: timestamp('human_reviewed_at', { withTimezone: true }),

    // Final resolution
    finalResolution: varchar('final_resolution', { length: 50 }),
    resolutionReason: text('resolution_reason'),

    // Idempotency
    idempotencyKey: varchar('idempotency_key', { length: 100 }).unique(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_issues_status').on(table.status),
    index('idx_issues_type').on(table.type),
    index('idx_issues_customer').on(table.customerId),
    index('idx_issues_transaction').on(table.transactionId),
    index('idx_issues_created').on(table.createdAt),
    index('idx_issues_priority_created').on(table.priority, table.createdAt),
    index('idx_issues_idempotency').on(table.idempotencyKey),
  ]
);

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
