import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().default(3000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  database: z.object({
    url: z.string().min(1, 'DATABASE_URL is required'),
    replicaUrl: z.string().optional(), // Read replica for reporting queries
    poolMax: z.coerce.number().default(10),
  }),

  redis: z.object({
    url: z.string().min(1, 'REDIS_URL is required'),
  }),

  queue: z.object({
    concurrency: z.coerce.number().default(5),
    maxRetries: z.coerce.number().default(5),
    backoffDelayMs: z.coerce.number().default(2000),
  }),

  security: z.object({
    encryptionKey: z
      .string()
      .length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  }),

  // Decision Engine
  decisionEngine: z.object({
    mode: z.enum(['rules', 'ai']).default('rules'),
    anthropicApiKey: z.string().optional(),
    // Confidence thresholds (0-100 scale for AI responses)
    autoResolveThreshold: z.coerce.number().min(0).max(100).default(90),
    humanReviewThreshold: z.coerce.number().min(0).max(100).default(70),
  }),

  // Legacy: kept for backward compatibility with rule-based engine
  confidenceThreshold: z.coerce.number().min(0).max(1).default(0.8),

  rateLimit: z.object({
    max: z.coerce.number().default(100),
    windowMs: z.coerce.number().default(60000),
  }),

  healthCheck: z.object({
    timeoutMs: z.coerce.number().default(2000),
  }),

  shutdown: z.object({
    timeoutMs: z.coerce.number().default(30000),
  }),

  // Maintenance jobs
  maintenance: z.object({
    enabled: z.coerce.boolean().default(true),
    archival: z.object({
      // Archive issues older than this many days
      olderThanDays: z.coerce.number().default(30),
      // Purge archived issues older than this many days (default 2 years)
      purgeAfterDays: z.coerce.number().default(730),
      // Cron schedule for archival job (default: daily at 2 AM)
      schedule: z.string().default('0 2 * * *'),
    }),
    partition: z.object({
      // Cron schedule for partition creation (default: 1st of month at 3 AM)
      schedule: z.string().default('0 3 1 * *'),
    }),
  }),
});

const configInput = {
  nodeEnv: process.env['NODE_ENV'],
  port: process.env['PORT'],
  logLevel: process.env['LOG_LEVEL'],

  database: {
    url: process.env['DATABASE_URL'],
    replicaUrl: process.env['DATABASE_REPLICA_URL'],
    poolMax: process.env['DATABASE_POOL_MAX'],
  },

  redis: {
    url: process.env['REDIS_URL'],
  },

  queue: {
    concurrency: process.env['QUEUE_CONCURRENCY'],
    maxRetries: process.env['QUEUE_MAX_RETRIES'],
    backoffDelayMs: process.env['QUEUE_BACKOFF_DELAY_MS'],
  },

  security: {
    encryptionKey: process.env['ENCRYPTION_KEY'],
  },

  decisionEngine: {
    mode: process.env['DECISION_ENGINE_MODE'],
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    autoResolveThreshold: process.env['AI_AUTO_RESOLVE_THRESHOLD'],
    humanReviewThreshold: process.env['AI_HUMAN_REVIEW_THRESHOLD'],
  },

  confidenceThreshold: process.env['CONFIDENCE_THRESHOLD'],

  rateLimit: {
    max: process.env['RATE_LIMIT_MAX'],
    windowMs: process.env['RATE_LIMIT_WINDOW_MS'],
  },

  healthCheck: {
    timeoutMs: process.env['HEALTH_CHECK_TIMEOUT_MS'],
  },

  shutdown: {
    timeoutMs: process.env['SHUTDOWN_TIMEOUT_MS'],
  },

  maintenance: {
    enabled: process.env['MAINTENANCE_ENABLED'],
    archival: {
      olderThanDays: process.env['MAINTENANCE_ARCHIVE_OLDER_THAN_DAYS'],
      purgeAfterDays: process.env['MAINTENANCE_ARCHIVE_PURGE_AFTER_DAYS'],
      schedule: process.env['MAINTENANCE_ARCHIVE_SCHEDULE'],
    },
    partition: {
      schedule: process.env['MAINTENANCE_PARTITION_SCHEDULE'],
    },
  },
};

// Parse and validate configuration - fail fast if invalid
const parseResult = configSchema.safeParse(configInput);

if (!parseResult.success) {
  console.error('Invalid configuration:');
  for (const issue of parseResult.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parseResult.data;

export type Config = typeof config;
