import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client.js';
import { redis, closeRedis } from '../src/lib/redis.js';
import { issueQueue, closeQueue } from '../src/queue/queueManager.js';

// Mock the Claude Agent SDK globally to prevent API calls during tests
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* () {
    yield {
      type: 'result',
      result: JSON.stringify({
        decision: 'auto_resolve',
        action: 'approve_retry',
        confidence: 85,
        reasoning: 'Mocked AI response for testing',
        policyApplied: 'test_policy',
      }),
    };
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
