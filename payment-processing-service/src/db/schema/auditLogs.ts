import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { auditActionEnum, auditEntityTypeEnum } from './enums';

// Type for changes JSONB
export interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// Type for metadata JSONB
export interface AuditMetadata {
  userAgent?: string;
  endpoint?: string;
  piiFieldsAccessed?: string[];
  decisionConfidence?: number;
  [key: string]: unknown;
}

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Entity identification
    entityType: auditEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),

    // Action
    action: auditActionEnum('action').notNull(),

    // Actor
    actor: varchar('actor', { length: 255 }).notNull(), // User email, 'system', or 'worker:{id}'
    actorIp: varchar('actor_ip', { length: 45 }), // IPv4 or IPv6

    // Request correlation
    requestId: varchar('request_id', { length: 100 }),

    // Changes (for updates)
    changes: jsonb('changes').$type<AuditChange[]>(),

    // Additional context
    metadata: jsonb('metadata').$type<AuditMetadata>(),

    // Timestamp
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_audit_entity').on(table.entityType, table.entityId, table.createdAt),
    index('idx_audit_actor').on(table.actor, table.createdAt),
    index('idx_audit_action').on(table.action, table.createdAt),
    index('idx_audit_request').on(table.requestId),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
