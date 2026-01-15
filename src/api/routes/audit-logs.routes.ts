import type { FastifyInstance } from 'fastify';
import { listAuditLogs } from '../controllers/index.js';

export async function auditLogsRoutes(app: FastifyInstance): Promise<void> {
  // List audit logs
  app.get('/audit-logs', {
    schema: {
      tags: ['audit-logs'],
      summary: 'List audit logs',
      description: 'List audit log entries with optional filtering and pagination',
      querystring: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: ['issue', 'customer', 'transaction'],
          },
          entity_id: { type: 'string', format: 'uuid' },
          action: {
            type: 'string',
            enum: ['create', 'update', 'delete', 'review', 'pii_access'],
          },
          actor: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  entity_type: { type: 'string' },
                  entity_id: { type: 'string' },
                  action: { type: 'string' },
                  actor: { type: 'string' },
                  actor_ip: { type: 'string', nullable: true },
                  request_id: { type: 'string', nullable: true },
                  changes: {
                    type: 'array',
                    nullable: true,
                    items: {
                      type: 'object',
                      properties: {
                        field: { type: 'string' },
                        oldValue: {},
                        newValue: {},
                      },
                    },
                  },
                  metadata: { type: 'object', nullable: true, additionalProperties: true },
                  created_at: { type: 'string' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                total_pages: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    handler: listAuditLogs,
  });
}
