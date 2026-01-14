import type { FastifyRequest, FastifyReply } from 'fastify';
import { testConnection } from '../../db/client.js';
import { config } from '../../config/index.js';

interface ServiceHealth {
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceHealth;
  };
}

/**
 * Quick liveness check - just confirms the server is running.
 */
export async function livenessCheck(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.send({ status: 'ok' });
}

/**
 * Deep readiness check - verifies all dependencies are healthy.
 */
export async function readinessCheck(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const timeout = config.healthCheck.timeoutMs;

  // Check database with timeout
  const dbHealth = await checkServiceHealth(async () => {
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }
  }, timeout);

  // Determine overall status
  const allHealthy = dbHealth.status === 'healthy';
  const overallStatus: HealthResponse['status'] = allHealthy
    ? 'healthy'
    : 'unhealthy';

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env['npm_package_version'] ?? '1.0.0',
    uptime: process.uptime(),
    services: {
      database: dbHealth,
    },
  };

  const statusCode = overallStatus === 'healthy' ? 200 : 503;
  reply.status(statusCode).send(response);
}

/**
 * Helper to check a service with timeout.
 */
async function checkServiceHealth(
  check: () => Promise<void>,
  timeoutMs: number
): Promise<ServiceHealth> {
  const startTime = Date.now();

  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
      }),
    ]);

    return {
      status: 'healthy',
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
