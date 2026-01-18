import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { closeDatabase, testConnection } from './db/client.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { requestIdHook } from './api/middleware/requestId.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { issueRoutes } from './api/routes/issues.routes.js';
import { analyticsRoutes } from './api/routes/analytics.routes.js';
import { auditLogsRoutes } from './api/routes/audit-logs.routes.js';

// Create Fastify instance
const app = Fastify({
  loggerInstance: logger,
  genReqId: () => `req_${crypto.randomUUID()}`,
});

// Register plugins
async function registerPlugins() {
  // CORS
  await app.register(cors, {
    origin: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)} seconds`,
      },
    }),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Payment Issue Processing API',
        version: '1.0.0',
        description: 'API for processing payment issues (declines, disputes, refunds)',
      },
      servers: [{ url: `http://localhost:${config.port}` }],
      tags: [
        { name: 'issues', description: 'Payment issue operations' },
        { name: 'analytics', description: 'Decision analytics and statistics' },
        { name: 'audit-logs', description: 'Audit log operations' },
        { name: 'health', description: 'Service health checks' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  });
}

// Register hooks
function registerHooks() {
  // Add request ID to all requests
  app.addHook('onRequest', requestIdHook);
}

// Register routes
async function registerRoutes() {
  await app.register(healthRoutes);
  await app.register(issueRoutes, { prefix: '/api/v1' });
  await app.register(analyticsRoutes, { prefix: '/api/v1' });
  await app.register(auditLogsRoutes, { prefix: '/api/v1' });
}

// Set error handler
function setErrorHandler() {
  // Type assertion needed due to exactOptionalPropertyTypes
  app.setErrorHandler(errorHandler);
}

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Received shutdown signal');

  const shutdownTimeout = config.shutdown.timeoutMs;
  const startTime = Date.now();

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Shutdown timeout reached'));
    }, shutdownTimeout);
  });

  try {
    // Race between graceful shutdown and timeout
    await Promise.race([
      (async () => {
        // Stop accepting new requests
        await app.close();
        logger.info('HTTP server closed');

        // Close database connections
        await closeDatabase();
        logger.info('Database connection closed');

        logger.info(
          { durationMs: Date.now() - startTime },
          'Graceful shutdown complete'
        );
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    logger.warn({ error }, 'Shutdown timeout reached, forcing exit');
  }

  process.exit(0);
}

// Start server
async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database');
      process.exit(1);
    }
    logger.info('Database connection successful');

    // Register everything
    await registerPlugins();
    registerHooks();
    setErrorHandler();
    await registerRoutes();

    // Start listening
    await app.listen({ port: config.port, host: '0.0.0.0' });

    logger.info(
      { port: config.port, env: config.nodeEnv },
      'Server started successfully'
    );

    // Setup graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
