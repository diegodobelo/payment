import { db } from '../db/client.js';
import {
  auditLogs,
  type NewAuditLog,
  type AuditChange,
  type AuditMetadata,
} from '../db/schema/index.js';
import type { AuditAction, AuditEntityType } from '../db/schema/enums.js';

export interface CreateAuditLogParams {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  actor: string;
  actorIp?: string;
  requestId?: string;
  changes?: AuditChange[];
  metadata?: AuditMetadata;
}

/**
 * Create an audit log entry.
 * This is a write-only operation - audit logs are never updated or deleted.
 */
export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  const record: NewAuditLog = {
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actor: params.actor,
    actorIp: params.actorIp ?? null,
    requestId: params.requestId ?? null,
    changes: params.changes ?? null,
    metadata: params.metadata ?? null,
  };

  await db.insert(auditLogs).values(record);
}

/**
 * Log PII access for compliance tracking.
 */
export async function logPiiAccess(params: {
  entityType: AuditEntityType;
  entityId: string;
  actor: string;
  piiFieldsAccessed: string[];
  actorIp?: string;
  requestId?: string;
}): Promise<void> {
  const auditParams: CreateAuditLogParams = {
    entityType: params.entityType,
    entityId: params.entityId,
    action: 'pii_access',
    actor: params.actor,
    metadata: {
      piiFieldsAccessed: params.piiFieldsAccessed,
    },
  };

  if (params.actorIp !== undefined) {
    auditParams.actorIp = params.actorIp;
  }
  if (params.requestId !== undefined) {
    auditParams.requestId = params.requestId;
  }

  await createAuditLog(auditParams);
}

export const auditLogRepository = {
  create: createAuditLog,
  logPiiAccess,
};
