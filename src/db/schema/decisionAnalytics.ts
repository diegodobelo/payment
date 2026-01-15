import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { issues } from './issues';

/**
 * Decision analytics table for tracking AI vs human decisions.
 * Used to measure AI accuracy and identify areas for improvement.
 */
export const decisionAnalytics = pgTable(
  'decision_analytics',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Issue relationship
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),

    // AI Decision
    aiDecision: varchar('ai_decision', { length: 50 }), // auto_resolve, human_review, escalate
    aiAction: varchar('ai_action', { length: 50 }), // approve_retry, approve_refund, reject, escalate
    aiConfidence: numeric('ai_confidence', { precision: 5, scale: 2 }), // 0-100
    aiReasoning: text('ai_reasoning'),
    aiPolicyApplied: varchar('ai_policy_applied', { length: 255 }),

    // Human Decision
    humanDecision: varchar('human_decision', { length: 50 }), // approve, reject, modify
    humanAction: varchar('human_action', { length: 50 }), // The action the human chose
    humanReason: text('human_reason'),

    // Agreement tracking
    agreement: varchar('agreement', { length: 50 }), // agreed, modified, rejected

    // Reviewer info
    reviewedBy: varchar('reviewed_by', { length: 255 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_analytics_issue').on(table.issueId),
    index('idx_analytics_agreement').on(table.agreement),
    index('idx_analytics_reviewed_at').on(table.reviewedAt),
  ]
);

export type DecisionAnalyticsEntry = typeof decisionAnalytics.$inferSelect;
export type NewDecisionAnalyticsEntry = typeof decisionAnalytics.$inferInsert;
