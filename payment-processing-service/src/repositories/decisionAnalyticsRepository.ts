import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
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
    aiPolicyApplied: params.aiPolicyApplied ?? null,
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
 */
export async function getAgreementStats(): Promise<{
  total: number;
  agreed: number;
  modified: number;
  rejected: number;
  pending: number;
}> {
  const all = await db.select().from(decisionAnalytics);

  const stats = {
    total: all.length,
    agreed: 0,
    modified: 0,
    rejected: 0,
    pending: 0,
  };

  for (const entry of all) {
    switch (entry.agreement) {
      case 'agreed':
        stats.agreed++;
        break;
      case 'modified':
        stats.modified++;
        break;
      case 'rejected':
        stats.rejected++;
        break;
      default:
        stats.pending++;
    }
  }

  return stats;
}

export const decisionAnalyticsRepository = {
  createAIDecision,
  recordHumanReview,
  findByIssueId,
  getAgreementStats,
};
