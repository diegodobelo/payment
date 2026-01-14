import { beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client.js';
import { redis, closeRedis } from '../src/lib/redis.js';
import { issueQueue, closeQueue } from '../src/queue/queueManager.js';

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
