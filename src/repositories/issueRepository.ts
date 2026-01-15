import { eq, and, desc, asc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  issues,
  type Issue,
  type NewIssue,
  type IssueDetails,
} from '../db/schema/index.js';
import type {
  IssueType,
  IssueStatus,
  PriorityLevel,
  DecisionType,
} from '../db/schema/enums.js';
import { createAuditLog, type CreateAuditLogParams } from './auditLogRepository.js';
import type { AuditContext } from './customerRepository.js';

/**
 * Parameters for creating a new issue.
 */
export interface CreateIssueParams {
  externalId: string;
  type: IssueType;
  customerId: string;
  transactionId: string;
  details: IssueDetails;
  priority?: PriorityLevel;
  idempotencyKey?: string;
}

/**
 * Parameters for updating an issue.
 */
export interface UpdateIssueParams {
  status?: IssueStatus;
  priority?: PriorityLevel;
  retryCount?: number;
  lastRetryAt?: Date;
  automatedDecision?: DecisionType;
  automatedDecisionConfidence?: string;
  automatedDecisionReason?: string;
  humanDecision?: DecisionType;
  humanDecisionReason?: string;
  humanReviewerEmail?: string;
  humanReviewedAt?: Date;
  finalResolution?: string;
  resolutionReason?: string;
  resolvedAt?: Date;
}

/**
 * Filters for listing issues.
 */
export interface IssueFilters {
  status?: IssueStatus;
  type?: IssueType;
  customerId?: string;
  priority?: PriorityLevel;
}

/**
 * Pagination options.
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'priority' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated result.
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Helper to build audit log params with proper optional property handling.
 */
function buildAuditParams(
  entityId: string,
  action: CreateAuditLogParams['action'],
  audit: AuditContext,
  extra?: { changes?: CreateAuditLogParams['changes']; metadata?: CreateAuditLogParams['metadata'] }
): CreateAuditLogParams {
  const params: CreateAuditLogParams = {
    entityType: 'issue',
    entityId,
    action,
    actor: audit.actor,
  };
  if (audit.actorIp !== undefined) params.actorIp = audit.actorIp;
  if (audit.requestId !== undefined) params.requestId = audit.requestId;
  if (extra?.changes !== undefined) params.changes = extra.changes;
  if (extra?.metadata !== undefined) params.metadata = extra.metadata;
  return params;
}

/**
 * Create a new issue.
 * Returns null if idempotency key already exists.
 */
export async function create(
  params: CreateIssueParams,
  audit?: AuditContext
): Promise<Issue | null> {
  // Check idempotency key if provided
  if (params.idempotencyKey) {
    const existing = await findByIdempotencyKey(params.idempotencyKey);
    if (existing) {
      return null; // Duplicate request
    }
  }

  const record: NewIssue = {
    externalId: params.externalId,
    type: params.type,
    customerId: params.customerId,
    transactionId: params.transactionId,
    details: params.details,
    priority: params.priority ?? 'normal',
    idempotencyKey: params.idempotencyKey ?? null,
  };

  const result = await db.insert(issues).values(record).returning();
  const issue = result[0]!;

  // Log creation
  if (audit) {
    await createAuditLog(
      buildAuditParams(issue.id, 'create', audit, {
        metadata: {
          issueType: params.type,
          priority: params.priority ?? 'normal',
        },
      })
    );
  }

  return issue;
}

/**
 * Find an issue by internal UUID.
 */
export async function findById(id: string): Promise<Issue | null> {
  const result = await db.select().from(issues).where(eq(issues.id, id));
  return result[0] ?? null;
}

/**
 * Find an issue by external ID.
 */
export async function findByExternalId(externalId: string): Promise<Issue | null> {
  const result = await db
    .select()
    .from(issues)
    .where(eq(issues.externalId, externalId));
  return result[0] ?? null;
}

/**
 * Find an issue by idempotency key.
 */
export async function findByIdempotencyKey(
  idempotencyKey: string
): Promise<Issue | null> {
  const result = await db
    .select()
    .from(issues)
    .where(eq(issues.idempotencyKey, idempotencyKey));
  return result[0] ?? null;
}

/**
 * List issues with optional filters and pagination.
 */
export async function findAll(
  filters?: IssueFilters,
  pagination?: PaginationOptions
): Promise<PaginatedResult<Issue>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 20;
  const offset = (page - 1) * limit;
  const sortBy = pagination?.sortBy ?? 'createdAt';
  const sortOrder = pagination?.sortOrder ?? 'desc';

  // Build where conditions
  const conditions: SQL[] = [];

  if (filters?.status) {
    conditions.push(eq(issues.status, filters.status));
  }
  if (filters?.type) {
    conditions.push(eq(issues.type, filters.type));
  }
  if (filters?.customerId) {
    conditions.push(eq(issues.customerId, filters.customerId));
  }
  if (filters?.priority) {
    conditions.push(eq(issues.priority, filters.priority));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort column
  const sortColumn =
    sortBy === 'priority'
      ? issues.priority
      : sortBy === 'updatedAt'
        ? issues.updatedAt
        : issues.createdAt;
  const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issues)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  // Get paginated data
  const data = await db
    .select()
    .from(issues)
    .where(whereClause)
    .orderBy(orderBy)
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

/**
 * Update an issue.
 */
export async function update(
  id: string,
  params: UpdateIssueParams,
  audit?: AuditContext
): Promise<Issue | null> {
  // Get current state for audit logging
  const current = await findById(id);
  if (!current) {
    return null;
  }

  const updateData: Partial<Issue> = {
    ...params,
    updatedAt: new Date(),
  };

  const result = await db
    .update(issues)
    .set(updateData)
    .where(eq(issues.id, id))
    .returning();

  const updated = result[0];
  if (!updated) {
    return null;
  }

  // Log update with changes
  if (audit) {
    const changes = Object.entries(params)
      .filter(([key, value]) => {
        const currentValue = current[key as keyof Issue];
        return value !== currentValue;
      })
      .map(([field, newValue]) => ({
        field,
        oldValue: current[field as keyof Issue] as unknown,
        newValue: newValue as unknown,
      }));

    if (changes.length > 0) {
      await createAuditLog(buildAuditParams(id, 'update', audit, { changes }));
    }
  }

  return updated;
}

/**
 * Update issue status specifically (convenience method).
 */
export async function updateStatus(
  id: string,
  status: IssueStatus,
  audit?: AuditContext
): Promise<Issue | null> {
  const isResolved = status === 'resolved' || status === 'failed';
  const updateParams: UpdateIssueParams = { status };
  if (isResolved) {
    updateParams.resolvedAt = new Date();
  }
  return update(id, updateParams, audit);
}

export const issueRepository = {
  create,
  findById,
  findByExternalId,
  findByIdempotencyKey,
  findAll,
  update,
  updateStatus,
};
