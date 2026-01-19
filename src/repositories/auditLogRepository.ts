import { desc, eq, and, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { dbReplica } from '../db/replica.js';
import {
  auditLogs,
  type NewAuditLog,
  type AuditChange,
  type AuditMetadata,
  type AuditLog,
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

export interface LogPiiAccessParams {
  entityType: AuditEntityType;
  entityId: string;
  actor: string;
  piiFieldsAccessed: string[];
  actorIp?: string;
  requestId?: string;
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
export async function logPiiAccess(params: LogPiiAccessParams): Promise<void> {
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

/**
 * Filters for listing audit logs.
 */
export interface AuditLogFilters {
  entityType?: AuditEntityType;
  entityId?: string;
  action?: AuditAction;
  actor?: string;
}

/**
 * Pagination options.
 */
export interface AuditLogPaginationOptions {
  page?: number;
  limit?: number;
}

/**
 * Paginated result.
 */
export interface PaginatedAuditLogResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * List audit logs with optional filters and pagination.
 */
export async function findAll(
  filters?: AuditLogFilters,
  pagination?: AuditLogPaginationOptions
): Promise<PaginatedAuditLogResult<AuditLog>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 20;
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions: SQL[] = [];

  if (filters?.entityType) {
    conditions.push(eq(auditLogs.entityType, filters.entityType));
  }
  if (filters?.entityId) {
    conditions.push(eq(auditLogs.entityId, filters.entityId));
  }
  if (filters?.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }
  if (filters?.actor) {
    conditions.push(eq(auditLogs.actor, filters.actor));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await dbReplica
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  // Get paginated data
  const data = await dbReplica
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export const auditLogRepository = {
  createAuditLog,
  logPiiAccess,
  findAll,
};
