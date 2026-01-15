import type { FastifyInstance } from 'fastify';
import {
  createIssue,
  getIssue,
  listIssues,
  reviewIssue,
} from '../controllers/index.js';

export async function issueRoutes(app: FastifyInstance): Promise<void> {
  // Create a new issue
  app.post('/issues', {
    schema: {
      tags: ['issues'],
      summary: 'Create a new payment issue',
      description: 'Create a new issue for processing (decline, dispute, refund request, etc.)',
      body: {
        type: 'object',
        required: ['type', 'customer_id', 'transaction_id', 'details'],
        properties: {
          idempotency_key: { type: 'string', maxLength: 100 },
          type: {
            type: 'string',
            enum: ['decline', 'missed_installment', 'dispute', 'refund_request'],
          },
          customer_id: { type: 'string', minLength: 1 },
          transaction_id: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'critical'],
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            external_id: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    handler: createIssue,
  });

  // Get issue by ID
  app.get('/issues/:id', {
    schema: {
      tags: ['issues'],
      summary: 'Get an issue by ID',
      description: 'Retrieve full details of a payment issue',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            external_id: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            customer_id: { type: 'string' },
            transaction_id: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
            retry_count: { type: 'integer' },
            last_retry_at: { type: 'string', nullable: true },
            automated_decision: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
            },
            human_review: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
            },
            final_resolution: { type: 'string', nullable: true },
            resolution_reason: { type: 'string', nullable: true },
            processing_history: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from_status: { type: 'string', nullable: true },
                  to_status: { type: 'string' },
                  changed_by: { type: 'string' },
                  reason: { type: 'string', nullable: true },
                  timestamp: { type: 'string' },
                },
              },
            },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
            resolved_at: { type: 'string', nullable: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: getIssue,
  });

  // List issues
  app.get('/issues', {
    schema: {
      tags: ['issues'],
      summary: 'List issues',
      description: 'List issues with optional filtering and pagination',
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'awaiting_review', 'resolved', 'failed'],
          },
          type: {
            type: 'string',
            enum: ['decline', 'missed_installment', 'dispute', 'refund_request'],
          },
          customer_id: { type: 'string' },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'critical'],
          },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          sort_by: {
            type: 'string',
            enum: ['createdAt', 'priority', 'updatedAt'],
          },
          sort_order: {
            type: 'string',
            enum: ['asc', 'desc'],
          },
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
                  external_id: { type: 'string' },
                  type: { type: 'string' },
                  status: { type: 'string' },
                  priority: { type: 'string' },
                  automated_decision: { type: 'string', nullable: true },
                  human_decision: { type: 'string', nullable: true },
                  final_resolution: { type: 'string', nullable: true },
                  created_at: { type: 'string' },
                  updated_at: { type: 'string' },
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
    handler: listIssues,
  });

  // Submit human review
  app.post('/issues/:id/review', {
    schema: {
      tags: ['issues'],
      summary: 'Submit a human review',
      description: 'Submit a human review decision for an issue awaiting review',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['decision', 'reason', 'reviewer_email'],
        properties: {
          decision: {
            type: 'string',
            enum: [
              'retry_payment', 'block_card',           // decline
              'approve_refund', 'deny_refund',         // refund_request
              'accept_dispute', 'contest_dispute',     // dispute
              'send_reminder', 'charge_late_fee',      // missed_installment
              'escalate',                              // common
            ],
          },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          reviewer_email: { type: 'string', format: 'email' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            final_resolution: { type: 'string' },
            human_decision: { type: 'string' },
            reviewed_at: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'object' },
          },
        },
        422: {
          type: 'object',
          properties: {
            error: { type: 'object' },
          },
        },
      },
    },
    handler: reviewIssue,
  });
}
