import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { issues } from './issues';

export const statusHistory = pgTable(
  'status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Issue relationship
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),

    // Status transition
    fromStatus: varchar('from_status', { length: 50 }),
    toStatus: varchar('to_status', { length: 50 }).notNull(),

    // Context
    changedBy: varchar('changed_by', { length: 255 }).notNull(), // system, user email, or worker ID
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Timestamp
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('idx_history_issue').on(table.issueId, table.createdAt)]
);

export type StatusHistoryEntry = typeof statusHistory.$inferSelect;
export type NewStatusHistoryEntry = typeof statusHistory.$inferInsert;
