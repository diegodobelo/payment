import { sql, inArray, lt, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { issues, issuesArchive } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

/**
 * Archive result summary.
 */
export interface ArchiveResult {
  archivedCount: number;
  errors: string[];
}

/**
 * Archive resolved issues older than the specified number of days.
 *
 * Moves issues with status 'resolved' or 'failed' that haven't been updated
 * in the specified time period to the issues_archive table.
 *
 * @param olderThanDays - Archive issues not updated in this many days (default: 30)
 * @param batchSize - Number of issues to process per batch (default: 1000)
 * @returns Summary of archived issues
 */
export async function archiveResolvedIssues(
  olderThanDays = 30,
  batchSize = 1000
): Promise<ArchiveResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const log = logger.child({
    operation: 'archiveResolvedIssues',
    olderThanDays,
    cutoffDate: cutoffDate.toISOString(),
    batchSize,
  });

  log.info('Starting issue archival');

  let totalArchived = 0;
  const errors: string[] = [];
  let hasMore = true;

  while (hasMore) {
    try {
      // Find issues to archive in this batch
      const issuesToArchive = await db
        .select()
        .from(issues)
        .where(
          and(
            inArray(issues.status, ['resolved', 'failed']),
            lt(issues.updatedAt, cutoffDate)
          )
        )
        .limit(batchSize);

      if (issuesToArchive.length === 0) {
        hasMore = false;
        break;
      }

      log.info({ batchCount: issuesToArchive.length }, 'Processing batch');

      // Archive in a transaction
      await db.transaction(async (tx) => {
        // Insert into archive table with archived_at timestamp
        const archiveRecords = issuesToArchive.map((issue) => ({
          id: issue.id,
          externalId: issue.externalId,
          type: issue.type,
          status: issue.status,
          priority: issue.priority,
          customerId: issue.customerId,
          transactionId: issue.transactionId,
          details: issue.details,
          retryCount: issue.retryCount,
          lastRetryAt: issue.lastRetryAt,
          automatedDecision: issue.automatedDecision,
          automatedDecisionConfidence: issue.automatedDecisionConfidence,
          automatedDecisionReason: issue.automatedDecisionReason,
          humanDecision: issue.humanDecision,
          humanDecisionReason: issue.humanDecisionReason,
          humanReviewerEmail: issue.humanReviewerEmail,
          humanReviewedAt: issue.humanReviewedAt,
          finalResolution: issue.finalResolution,
          resolutionReason: issue.resolutionReason,
          idempotencyKey: issue.idempotencyKey,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          resolvedAt: issue.resolvedAt,
          archivedAt: new Date(),
        }));

        await tx.insert(issuesArchive).values(archiveRecords);

        // Delete from main table
        const issueIds = issuesToArchive.map((i) => i.id);
        await tx.delete(issues).where(inArray(issues.id, issueIds));
      });

      totalArchived += issuesToArchive.length;
      log.info(
        { batchArchived: issuesToArchive.length, totalArchived },
        'Batch archived successfully'
      );

      // If we got fewer than batchSize, we're done
      if (issuesToArchive.length < batchSize) {
        hasMore = false;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: errorMessage }, 'Error archiving batch');
      errors.push(errorMessage);
      hasMore = false; // Stop on error to prevent data issues
    }
  }

  log.info({ totalArchived, errorCount: errors.length }, 'Archival complete');

  return {
    archivedCount: totalArchived,
    errors,
  };
}

/**
 * Purge result summary.
 */
export interface PurgeResult {
  purgedCount: number;
  errors: string[];
}

/**
 * Purge old archived issues beyond the retention period.
 *
 * Permanently deletes archived issues older than the specified number of days.
 * Default retention is 2 years (730 days).
 *
 * @param olderThanDays - Purge archives older than this many days (default: 730)
 * @param batchSize - Number of records to delete per batch (default: 1000)
 * @returns Summary of purged records
 */
export async function purgeOldArchives(
  olderThanDays = 730,
  batchSize = 1000
): Promise<PurgeResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const log = logger.child({
    operation: 'purgeOldArchives',
    olderThanDays,
    cutoffDate: cutoffDate.toISOString(),
    batchSize,
  });

  log.info('Starting archive purge');

  let totalPurged = 0;
  const errors: string[] = [];
  let hasMore = true;

  while (hasMore) {
    try {
      // Find archived issues to purge
      const toPurge = await db
        .select({ id: issuesArchive.id })
        .from(issuesArchive)
        .where(lt(issuesArchive.archivedAt, cutoffDate))
        .limit(batchSize);

      if (toPurge.length === 0) {
        hasMore = false;
        break;
      }

      log.info({ batchCount: toPurge.length }, 'Purging batch');

      // Delete the batch
      const ids = toPurge.map((r) => r.id);
      await db.delete(issuesArchive).where(inArray(issuesArchive.id, ids));

      totalPurged += toPurge.length;
      log.info({ batchPurged: toPurge.length, totalPurged }, 'Batch purged');

      if (toPurge.length < batchSize) {
        hasMore = false;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: errorMessage }, 'Error purging batch');
      errors.push(errorMessage);
      hasMore = false;
    }
  }

  log.info({ totalPurged, errorCount: errors.length }, 'Purge complete');

  return {
    purgedCount: totalPurged,
    errors,
  };
}

/**
 * Get archival statistics.
 */
export async function getArchiveStats(): Promise<{
  mainTableCount: number;
  archiveTableCount: number;
  oldestArchived: Date | null;
  newestArchived: Date | null;
}> {
  const [mainCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issues);

  const [archiveCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issuesArchive);

  const [oldest] = await db
    .select({ archivedAt: issuesArchive.archivedAt })
    .from(issuesArchive)
    .orderBy(issuesArchive.archivedAt)
    .limit(1);

  const [newest] = await db
    .select({ archivedAt: issuesArchive.archivedAt })
    .from(issuesArchive)
    .orderBy(sql`${issuesArchive.archivedAt} DESC`)
    .limit(1);

  return {
    mainTableCount: mainCount?.count ?? 0,
    archiveTableCount: archiveCount?.count ?? 0,
    oldestArchived: oldest?.archivedAt ?? null,
    newestArchived: newest?.archivedAt ?? null,
  };
}
