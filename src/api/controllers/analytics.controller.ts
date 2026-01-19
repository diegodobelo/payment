import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listDecisionsQuerySchema,
  type ListDecisionsQuery,
} from '../schemas/index.js';
import { ValidationError } from '../middleware/errorHandler.js';
import {
  decisionAnalyticsRepository,
  type DecisionAnalyticsFilters,
  type AnalyticsPaginationOptions,
} from '../../repositories/decisionAnalyticsRepository.js';

/**
 * Get AI decision agreement statistics.
 */
export async function getStats(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const stats = await decisionAnalyticsRepository.getAgreementStats();

  reply.send({
    total: stats.total,
    agreed: stats.agreed,
    modified: stats.modified,
    rejected: stats.rejected,
    pending: stats.pending,
    agreement_rate: stats.total > 0
      ? Math.round((stats.agreed / stats.total) * 100 * 100) / 100
      : 0,
  });
}

/**
 * List decision analytics records with optional filters and pagination.
 */
export async function listDecisions(
  request: FastifyRequest<{ Querystring: ListDecisionsQuery }>,
  reply: FastifyReply
): Promise<void> {
  // Validate query params
  const parseResult = listDecisionsQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    throw new ValidationError(parseResult.error);
  }

  const query = parseResult.data;

  // Build filters
  const filters: DecisionAnalyticsFilters = {};
  if (query.agreement) {
    if (query.agreement === 'pending') {
      filters.agreement = null;
    } else {
      filters.agreement = query.agreement;
    }
  }
  if (query.ai_decision) {
    filters.aiDecision = query.ai_decision;
  }

  // Build pagination options
  const paginationOptions: AnalyticsPaginationOptions = {};
  if (query.page !== undefined) paginationOptions.page = query.page;
  if (query.limit !== undefined) paginationOptions.limit = query.limit;

  const result = await decisionAnalyticsRepository.findAll(filters, paginationOptions);

  reply.send({
    data: result.data.map((record) => ({
      id: record.id,
      issue_id: record.issueId,
      ai_decision: record.aiDecision,
      ai_action: record.aiAction,
      ai_confidence: record.aiConfidence ? parseFloat(record.aiConfidence) : null,
      ai_reasoning: record.aiReasoning,
      ai_policy_applied: record.aiPolicyApplied,
      human_decision: record.humanDecision,
      human_action: record.humanAction,
      human_reason: record.humanReason,
      agreement: record.agreement,
      reviewed_by: record.reviewedBy,
      reviewed_at: record.reviewedAt?.toISOString() ?? null,
      created_at: record.createdAt.toISOString(),
    })),
    pagination: {
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      total_pages: result.pagination.totalPages,
    },
  });
}
