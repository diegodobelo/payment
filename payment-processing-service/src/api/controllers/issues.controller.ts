import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createIssueSchema,
  listIssuesQuerySchema,
  reviewIssueSchema,
  issueIdParamSchema,
  type CreateIssueRequest,
  type ListIssuesQuery,
  type ReviewIssueRequest,
  type IssueIdParam,
} from '../schemas/index.js';
import {
  NotFoundError,
  ConflictError,
  UnprocessableError,
  ValidationError,
} from '../middleware/index.js';
import { issueRepository } from '../../repositories/index.js';
import { customerRepository } from '../../repositories/customerRepository.js';
import { transactionRepository } from '../../repositories/transactionRepository.js';
import { statusHistoryRepository } from '../../repositories/statusHistoryRepository.js';
import { decisionAnalyticsRepository } from '../../repositories/decisionAnalyticsRepository.js';
import { enqueueIssue } from '../../queue/queueManager.js';
import type { AuditContext } from '../../repositories/customerRepository.js';
import type { IssueDetails } from '../../db/schema/issues.js';
import type { IssueType, PriorityLevel, IssueStatus } from '../../db/schema/enums.js';

/**
 * Generate a unique external ID for issues.
 */
function generateExternalId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `iss_${timestamp}${random}`;
}

/**
 * Build audit context from request.
 */
function getAuditContext(request: FastifyRequest): AuditContext {
  return {
    actor: 'api',
    actorIp: request.ip,
    requestId: request.id,
  };
}

/**
 * Create a new issue.
 */
export async function createIssue(
  request: FastifyRequest<{ Body: CreateIssueRequest }>,
  reply: FastifyReply
): Promise<void> {
  // Validate request body
  const parseResult = createIssueSchema.safeParse(request.body);
  if (!parseResult.success) {
    throw new ValidationError(parseResult.error);
  }

  const body = parseResult.data;
  const audit = getAuditContext(request);

  // Check if customer exists
  const customer = await customerRepository.findByExternalIdWithoutPii(body.customer_id);
  if (!customer) {
    throw new NotFoundError('Customer', body.customer_id);
  }

  // Check if transaction exists
  const transaction = await transactionRepository.findByExternalIdWithoutPii(body.transaction_id);
  if (!transaction) {
    throw new NotFoundError('Transaction', body.transaction_id);
  }

  // Build create params
  const createParams: Parameters<typeof issueRepository.create>[0] = {
    externalId: generateExternalId(),
    type: body.type as IssueType,
    customerId: customer.id,
    transactionId: transaction.id,
    details: body.details as IssueDetails,
    priority: (body.priority as PriorityLevel) ?? 'normal',
  };
  if (body.idempotency_key !== undefined) {
    createParams.idempotencyKey = body.idempotency_key;
  }

  // Create issue
  const issue = await issueRepository.create(createParams, audit);

  // Handle idempotency conflict
  if (!issue && body.idempotency_key) {
    const existing = await issueRepository.findByIdempotencyKey(body.idempotency_key);
    if (existing) {
      throw new ConflictError(
        'Request with this idempotency key already exists',
        existing.id
      );
    }
  }

  if (!issue) {
    throw new Error('Failed to create issue');
  }

  // Record initial status
  await statusHistoryRepository.create({
    issueId: issue.id,
    fromStatus: null,
    toStatus: 'pending',
    changedBy: 'system',
    reason: 'Issue created',
  });

  // Enqueue issue for processing
  const priority = body.priority === 'critical' ? 1 : body.priority === 'high' ? 2 : body.priority === 'low' ? 4 : 3;
  await enqueueIssue(issue.id, {
    priority,
    requestId: request.id,
  });

  reply.status(201).send({
    id: issue.id,
    external_id: issue.externalId,
    status: issue.status,
    created_at: issue.createdAt.toISOString(),
  });
}

/**
 * Get an issue by ID.
 */
export async function getIssue(
  request: FastifyRequest<{ Params: IssueIdParam }>,
  reply: FastifyReply
): Promise<void> {
  // Validate params
  const parseResult = issueIdParamSchema.safeParse(request.params);
  if (!parseResult.success) {
    throw new ValidationError(parseResult.error);
  }

  const { id } = parseResult.data;

  const issue = await issueRepository.findById(id);
  if (!issue) {
    throw new NotFoundError('Issue', id);
  }

  // Get status history
  const history = await statusHistoryRepository.findByIssueId(id);

  reply.send({
    id: issue.id,
    external_id: issue.externalId,
    type: issue.type,
    status: issue.status,
    priority: issue.priority,
    customer_id: issue.customerId,
    transaction_id: issue.transactionId,
    details: issue.details,
    retry_count: issue.retryCount,
    last_retry_at: issue.lastRetryAt?.toISOString() ?? null,
    automated_decision: issue.automatedDecision
      ? {
          decision: issue.automatedDecision,
          confidence: issue.automatedDecisionConfidence,
          reason: issue.automatedDecisionReason,
        }
      : null,
    human_review: issue.humanDecision
      ? {
          decision: issue.humanDecision,
          reason: issue.humanDecisionReason,
          reviewer_email: issue.humanReviewerEmail,
          reviewed_at: issue.humanReviewedAt?.toISOString(),
        }
      : null,
    final_resolution: issue.finalResolution,
    resolution_reason: issue.resolutionReason,
    processing_history: history.map((h) => ({
      from_status: h.fromStatus,
      to_status: h.toStatus,
      changed_by: h.changedBy,
      reason: h.reason,
      timestamp: h.createdAt.toISOString(),
    })),
    created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(),
    resolved_at: issue.resolvedAt?.toISOString() ?? null,
  });
}

/**
 * List issues with filtering and pagination.
 */
export async function listIssues(
  request: FastifyRequest<{ Querystring: ListIssuesQuery }>,
  reply: FastifyReply
): Promise<void> {
  // Validate query params
  const parseResult = listIssuesQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    throw new ValidationError(parseResult.error);
  }

  const query = parseResult.data;

  // Build filters
  const filters: Parameters<typeof issueRepository.findAll>[0] = {};
  if (query.status) filters.status = query.status as IssueStatus;
  if (query.type) filters.type = query.type as IssueType;
  if (query.priority) filters.priority = query.priority as PriorityLevel;

  // Handle customer_id filter (need to convert external ID to internal ID)
  if (query.customer_id) {
    const customer = await customerRepository.findByExternalIdWithoutPii(query.customer_id);
    if (customer) {
      filters.customerId = customer.id;
    } else {
      // No matching customer, return empty result
      reply.send({
        data: [],
        pagination: {
          page: query.page ?? 1,
          limit: query.limit ?? 20,
          total: 0,
          total_pages: 0,
        },
      });
      return;
    }
  }

  // Build pagination options
  const paginationOptions: Parameters<typeof issueRepository.findAll>[1] = {};
  if (query.page !== undefined) paginationOptions.page = query.page;
  if (query.limit !== undefined) paginationOptions.limit = query.limit;
  if (query.sort_by !== undefined) paginationOptions.sortBy = query.sort_by;
  if (query.sort_order !== undefined) paginationOptions.sortOrder = query.sort_order;

  const result = await issueRepository.findAll(filters, paginationOptions);

  reply.send({
    data: result.data.map((issue) => ({
      id: issue.id,
      external_id: issue.externalId,
      type: issue.type,
      status: issue.status,
      priority: issue.priority,
      created_at: issue.createdAt.toISOString(),
      updated_at: issue.updatedAt.toISOString(),
    })),
    pagination: {
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      total_pages: result.pagination.totalPages,
    },
  });
}

/**
 * Submit a human review for an issue.
 */
export async function reviewIssue(
  request: FastifyRequest<{ Params: IssueIdParam; Body: ReviewIssueRequest }>,
  reply: FastifyReply
): Promise<void> {
  // Validate params
  const paramsResult = issueIdParamSchema.safeParse(request.params);
  if (!paramsResult.success) {
    throw new ValidationError(paramsResult.error);
  }

  // Validate body
  const bodyResult = reviewIssueSchema.safeParse(request.body);
  if (!bodyResult.success) {
    throw new ValidationError(bodyResult.error);
  }

  const { id } = paramsResult.data;
  const body = bodyResult.data;
  const audit = getAuditContext(request);

  // Get current issue
  const issue = await issueRepository.findById(id);
  if (!issue) {
    throw new NotFoundError('Issue', id);
  }

  // Validate status
  if (issue.status !== 'awaiting_review') {
    throw new UnprocessableError(
      `Issue must be in 'awaiting_review' status to submit review. Current status: ${issue.status}`
    );
  }

  // Determine final resolution based on decision
  let finalResolution: string;
  switch (body.decision) {
    case 'approve_retry':
      finalResolution = 'approved_for_retry';
      break;
    case 'approve_refund':
      finalResolution = 'refunded';
      break;
    case 'reject':
      finalResolution = 'rejected';
      break;
    case 'escalate':
      finalResolution = 'escalated';
      break;
    default:
      finalResolution = 'resolved';
  }

  // Update issue with review
  const updated = await issueRepository.update(
    id,
    {
      status: 'resolved',
      humanDecision: body.decision,
      humanDecisionReason: body.reason,
      humanReviewerEmail: body.reviewer_email,
      humanReviewedAt: new Date(),
      finalResolution,
      resolutionReason: body.reason,
      resolvedAt: new Date(),
    },
    audit
  );

  if (!updated) {
    throw new Error('Failed to update issue');
  }

  // Record status change
  await statusHistoryRepository.create({
    issueId: id,
    fromStatus: 'awaiting_review',
    toStatus: 'resolved',
    changedBy: body.reviewer_email,
    reason: body.reason,
    metadata: { decision: body.decision },
  });

  // Record human review in analytics (if AI decision exists)
  if (issue.automatedDecision) {
    // Determine if human agreed with AI
    let humanDecision: 'approve' | 'reject' | 'modify';
    if (body.decision === issue.automatedDecision) {
      humanDecision = 'approve';
    } else if (body.decision === 'reject' || body.decision === 'escalate') {
      humanDecision = 'reject';
    } else {
      humanDecision = 'modify';
    }

    await decisionAnalyticsRepository.recordHumanReview(id, {
      humanDecision,
      humanAction: body.decision,
      humanReason: body.reason,
      reviewedBy: body.reviewer_email,
    });
  }

  reply.send({
    id: updated.id,
    status: updated.status,
    final_resolution: updated.finalResolution,
    human_decision: updated.humanDecision,
    reviewed_at: updated.humanReviewedAt?.toISOString(),
  });
}
