import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  listAuditLogsQuerySchema,
  type ListAuditLogsQuery,
} from '../schemas/index.js';
import { ValidationError } from '../middleware/errorHandler.js';
import { auditLogRepository } from '../../repositories/auditLogRepository.js';
import type { AuditAction, AuditEntityType } from '../../db/schema/enums.js';

/**
 * List audit logs with optional filters and pagination.
 */
export async function listAuditLogs(
  request: FastifyRequest<{ Querystring: ListAuditLogsQuery }>,
  reply: FastifyReply
): Promise<void> {
  // Validate query params
  const parseResult = listAuditLogsQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    throw new ValidationError(parseResult.error);
  }

  const query = parseResult.data;

  // Build filters
  const filters: Parameters<typeof auditLogRepository.findAll>[0] = {};
  if (query.entity_type) {
    filters.entityType = query.entity_type as AuditEntityType;
  }
  if (query.entity_id) {
    filters.entityId = query.entity_id;
  }
  if (query.action) {
    filters.action = query.action as AuditAction;
  }
  if (query.actor) {
    filters.actor = query.actor;
  }

  // Build pagination options
  const paginationOptions: Parameters<typeof auditLogRepository.findAll>[1] = {};
  if (query.page !== undefined) paginationOptions.page = query.page;
  if (query.limit !== undefined) paginationOptions.limit = query.limit;

  const result = await auditLogRepository.findAll(filters, paginationOptions);

  reply.send({
    data: result.data.map((record) => ({
      id: record.id,
      entity_type: record.entityType,
      entity_id: record.entityId,
      action: record.action,
      actor: record.actor,
      actor_ip: record.actorIp,
      request_id: record.requestId,
      changes: record.changes,
      metadata: record.metadata,
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
