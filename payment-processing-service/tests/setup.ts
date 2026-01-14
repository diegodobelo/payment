import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client.js';
import { redis, closeRedis } from '../src/lib/redis.js';
import { issueQueue, closeQueue } from '../src/queue/queueManager.js';

// Default AI response for backward compatibility
const defaultAIResponse = {
  type: 'result' as const,
  result: JSON.stringify({
    decision: 'auto_resolve',
    action: 'approve_retry',
    confidence: 85,
    reasoning: 'Mocked AI response for testing',
    policyApplied: 'test_policy',
  }),
};

// Configurable mock response - can be overridden per test
let mockResponse: { type: string; result?: string; error?: Error } | null = null;

/**
 * Set a custom AI SDK response for the next test.
 * Call with null to reset to default behavior.
 */
export function setMockAIResponse(response: { type: string; result?: string; error?: Error } | null): void {
  mockResponse = response;
}

/**
 * Reset mock to default response.
 */
export function resetMockAIResponse(): void {
  mockResponse = null;
}

// Mock the Claude Agent SDK globally with configurable responses
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* () {
    const response = mockResponse ?? defaultAIResponse;
    if (response.error) {
      throw response.error;
    }
    yield response;
  }),
}));

// Ensure test environment
if (process.env['NODE_ENV'] !== 'test') {
  process.env['NODE_ENV'] = 'test';
}

beforeAll(async () => {
  // Wait for connections to be established
  await new Promise((resolve) => setTimeout(resolve, 100));
});

beforeEach(async () => {
  // Clean up database tables (in correct order due to foreign keys)
  await db.execute(sql`TRUNCATE status_history CASCADE`);
  await db.execute(sql`TRUNCATE audit_logs CASCADE`);
  await db.execute(sql`TRUNCATE issues CASCADE`);
  await db.execute(sql`TRUNCATE transactions CASCADE`);
  await db.execute(sql`TRUNCATE customers CASCADE`);

  // Clean up Redis
  await redis.flushdb();

  // Clean up queue
  await issueQueue.obliterate({ force: true });
});

afterAll(async () => {
  await closeQueue();
  await closeRedis();
  await closeDatabase();
});
