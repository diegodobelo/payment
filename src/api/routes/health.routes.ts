import type { FastifyInstance } from 'fastify';
import { livenessCheck, readinessCheck } from '../controllers/index.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness probe - quick check that server is running
  app.get('/health/live', {
    schema: {
      tags: ['health'],
      summary: 'Liveness check',
      description: 'Quick check that the server is running',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
          },
        },
      },
    },
    handler: livenessCheck,
  });

  // Readiness probe - deep check of all dependencies
  app.get('/health/ready', {
    schema: {
      tags: ['health'],
      summary: 'Readiness check',
      description: 'Deep check of all service dependencies',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            version: { type: 'string' },
            uptime: { type: 'number' },
            services: {
              type: 'object',
              properties: {
                database: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    latencyMs: { type: 'number' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: { type: 'object' },
          },
        },
      },
    },
    handler: readinessCheck,
  });
}
