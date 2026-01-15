import type { FastifyInstance } from 'fastify';
import { getStats, listDecisions } from '../controllers/index.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // Get agreement statistics
  app.get('/analytics/stats', {
    schema: {
      tags: ['analytics'],
      summary: 'Get AI decision agreement statistics',
      description: 'Get aggregate statistics on AI vs human decision agreement',
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            agreed: { type: 'integer' },
            modified: { type: 'integer' },
            rejected: { type: 'integer' },
            pending: { type: 'integer' },
            agreement_rate: { type: 'number' },
          },
        },
      },
    },
    handler: getStats,
  });

  // List decision analytics records
  app.get('/analytics/decisions', {
    schema: {
      tags: ['analytics'],
      summary: 'List decision analytics records',
      description: 'List AI decision records with optional filtering and pagination',
      querystring: {
        type: 'object',
        properties: {
          agreement: {
            type: 'string',
            enum: ['agreed', 'modified', 'rejected', 'pending'],
          },
          ai_decision: { type: 'string' },
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
                  issue_id: { type: 'string' },
                  ai_decision: { type: 'string', nullable: true },
                  ai_action: { type: 'string', nullable: true },
                  ai_confidence: { type: 'number', nullable: true },
                  ai_reasoning: { type: 'string', nullable: true },
                  ai_policy_applied: { type: 'string', nullable: true },
                  human_decision: { type: 'string', nullable: true },
                  human_action: { type: 'string', nullable: true },
                  human_reason: { type: 'string', nullable: true },
                  agreement: { type: 'string', nullable: true },
                  reviewed_by: { type: 'string', nullable: true },
                  reviewed_at: { type: 'string', nullable: true },
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
    handler: listDecisions,
  });
}
