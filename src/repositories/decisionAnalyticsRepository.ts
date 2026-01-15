import { eq, sql, desc, and, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { dbReplica } from '../db/replica.js';
import {
  decisionAnalytics,
  type DecisionAnalyticsEntry,
  type NewDecisionAnalyticsEntry,
} from '../db/schema/index.js';

/**
 * Parameters for creating an AI decision record.
 */
export interface CreateAIDecisionParams {
  issueId: string;
  aiDecision: string;
  aiAction: string;
  aiConfidence: number;
  aiReasoning: string;
  aiPolicyApplied?: string;
}

/**
 * Parameters for recording a human review.
 */
export interface RecordHumanReviewParams {
  humanDecision: 'approve' | 'reject' | 'modify';
  humanAction?: string;
  humanReason: string;
  reviewedBy: string;
}

/**
 * Create an AI decision analytics record.
 * Called when AI makes a decision that needs human review.
 */
export async function createAIDecision(
  params: CreateAIDecisionParams
): Promise<DecisionAnalyticsEntry> {
  const record: NewDecisionAnalyticsEntry = {
    issueId: params.issueId,
    aiDecision: params.aiDecision,
    aiAction: params.aiAction,
    aiConfidence: params.aiConfidence.toString(),
    aiReasoning: params.aiReasoning,
    aiPolicyApplied: params.aiPolicyApplied?.slice(0, 255) ?? null,
  };

  const result = await db.insert(decisionAnalytics).values(record).returning();
  return result[0]!;
}

/**
 * Record a human review for an existing analytics entry.
 */
export async function recordHumanReview(
  issueId: string,
  params: RecordHumanReviewParams
): Promise<DecisionAnalyticsEntry | null> {
  // Find the analytics entry for this issue
  const existing = await findByIssueId(issueId);
  if (!existing) {
    return null;
  }

  // Determine agreement status
  let agreement: 'agreed' | 'modified' | 'rejected';
  if (params.humanDecision === 'approve') {
    agreement = 'agreed';
  } else if (params.humanDecision === 'modify') {
    agreement = 'modified';
  } else {
    agreement = 'rejected';
  }

  const result = await db
    .update(decisionAnalytics)
    .set({
      humanDecision: params.humanDecision,
      humanAction: params.humanAction ?? null,
      humanReason: params.humanReason,
      agreement,
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(eq(decisionAnalytics.id, existing.id))
    .returning();

  return result[0] ?? null;
}

/**
 * Find analytics entry by issue ID.
 */
export async function findByIssueId(
  issueId: string
): Promise<DecisionAnalyticsEntry | null> {
  const result = await db
    .select()
    .from(decisionAnalytics)
    .where(eq(decisionAnalytics.issueId, issueId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get agreement statistics for AI decisions.
 * Uses read replica for better performance on reporting queries.
 */
export async function getAgreementStats(): Promise<{
  total: number;
  agreed: number;
  modified: number;
  rejected: number;
  pending: number;
}> {
  // Use SQL aggregation on replica for efficient counting
  const result = await dbReplica
    .select({
      total: sql<number>`count(*)::int`,
      agreed: sql<number>`count(*) filter (where ${decisionAnalytics.agreement} = 'agreed')::int`,
      modified: sql<number>`count(*) filter (where ${decisionAnalytics.agreement} = 'modified')::int`,
      rejected: sql<number>`count(*) filter (where ${decisionAnalytics.agreement} = 'rejected')::int`,
      pending: sql<number>`count(*) filter (where ${decisionAnalytics.agreement} is null)::int`,
    })
    .from(decisionAnalytics);

  const row = result[0];
  return {
    total: row?.total ?? 0,
    agreed: row?.agreed ?? 0,
    modified: row?.modified ?? 0,
    rejected: row?.rejected ?? 0,
    pending: row?.pending ?? 0,
  };
}

/**
 * Filters for listing decision analytics.
 */
export interface DecisionAnalyticsFilters {
  agreement?: 'agreed' | 'modified' | 'rejected' | null;
  aiDecision?: string;
}

/**
 * Pagination options.
 */
export interface AnalyticsPaginationOptions {
  page?: number;
  limit?: number;
}

/**
 * Paginated result.
 */
export interface PaginatedAnalyticsResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * List decision analytics records with optional filters and pagination.
 */
export async function findAll(
  filters?: DecisionAnalyticsFilters,
  pagination?: AnalyticsPaginationOptions
): Promise<PaginatedAnalyticsResult<DecisionAnalyticsEntry>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 20;
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions: SQL[] = [];

  if (filters?.agreement !== undefined) {
    if (filters.agreement === null) {
      conditions.push(sql`${decisionAnalytics.agreement} is null`);
    } else {
      conditions.push(eq(decisionAnalytics.agreement, filters.agreement));
    }
  }
  if (filters?.aiDecision) {
    conditions.push(eq(decisionAnalytics.aiDecision, filters.aiDecision));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await dbReplica
    .select({ count: sql<number>`count(*)::int` })
    .from(decisionAnalytics)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  // Get paginated data
  const data = await dbReplica
    .select()
    .from(decisionAnalytics)
    .where(whereClause)
    .orderBy(desc(decisionAnalytics.createdAt))
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

export const decisionAnalyticsRepository = {
  createAIDecision,
  recordHumanReview,
  findByIssueId,
  getAgreementStats,
  findAll,
};
