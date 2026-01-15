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
} from './enums.js';
import type { IssueDetails } from './issues.js';

/**
 * Archive table for resolved issues.
 * Structure mirrors the issues table with an additional archived_at timestamp.
 */
export const issuesArchive = pgTable(
  'issues_archive',
  {
    id: uuid('id').primaryKey(),
    externalId: varchar('external_id', { length: 50 }).notNull(),

    // Core fields
    type: issueTypeEnum('type').notNull(),
    status: issueStatusEnum('status').notNull(),
    priority: priorityLevelEnum('priority').notNull(),

    // Relationships (not enforced with FK to allow orphaned archives)
    customerId: uuid('customer_id').notNull(),
    transactionId: uuid('transaction_id').notNull(),

    // Type-specific details
    details: jsonb('details').$type<IssueDetails>().notNull(),

    // Processing state
    retryCount: integer('retry_count').notNull(),
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
    idempotencyKey: varchar('idempotency_key', { length: 100 }),

    // Original timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    // Archive metadata
    archivedAt: timestamp('archived_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_issues_archive_external_id').on(table.externalId),
    index('idx_issues_archive_customer').on(table.customerId),
    index('idx_issues_archive_created').on(table.createdAt),
    index('idx_issues_archive_archived').on(table.archivedAt),
  ]
);

export type ArchivedIssue = typeof issuesArchive.$inferSelect;
export type NewArchivedIssue = typeof issuesArchive.$inferInsert;
