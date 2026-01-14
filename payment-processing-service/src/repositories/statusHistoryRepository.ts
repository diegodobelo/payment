import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  statusHistory,
  type StatusHistoryEntry,
  type NewStatusHistoryEntry,
} from '../db/schema/index.js';

/**
 * Parameters for creating a status history entry.
 */
export interface CreateStatusHistoryParams {
  issueId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a status history entry.
 * This is append-only - entries are never updated or deleted.
 */
export async function create(
  params: CreateStatusHistoryParams
): Promise<StatusHistoryEntry> {
  const record: NewStatusHistoryEntry = {
    issueId: params.issueId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    changedBy: params.changedBy,
    reason: params.reason ?? null,
    metadata: params.metadata ?? null,
  };

  const result = await db.insert(statusHistory).values(record).returning();
  return result[0]!;
}

/**
 * Find all status history entries for an issue, ordered by creation time.
 */
export async function findByIssueId(
  issueId: string
): Promise<StatusHistoryEntry[]> {
  return db
    .select()
    .from(statusHistory)
    .where(eq(statusHistory.issueId, issueId))
    .orderBy(asc(statusHistory.createdAt));
}

/**
 * Get the most recent status history entry for an issue.
 */
export async function findLatestByIssueId(
  issueId: string
): Promise<StatusHistoryEntry | null> {
  const result = await db
    .select()
    .from(statusHistory)
    .where(eq(statusHistory.issueId, issueId))
    .orderBy(asc(statusHistory.createdAt));

  return result[result.length - 1] ?? null;
}

export const statusHistoryRepository = {
  create,
  findByIssueId,
  findLatestByIssueId,
};
