import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { issues } from '../../src/db/schema/index.js';
import { buildApp, seedTestCustomer, seedTestTransaction } from '../helpers.js';

describe('Edge Cases', () => {
  describe('Concurrent Idempotency', () => {
    let app: FastifyInstance;
    let customerExternalId: string;
    let transactionExternalId: string;

    beforeEach(async () => {
      app = await buildApp();
      const customer = await seedTestCustomer();
      customerExternalId = customer.externalId;
      const transaction = await seedTestTransaction(customer.id);
      transactionExternalId = transaction.externalId;
    });

    it('should handle concurrent requests with same idempotency key - only one succeeds', async () => {
      const idempotencyKey = `concurrent-test-${Date.now()}`;
      const payload = {
        idempotency_key: idempotencyKey,
        type: 'decline',
        customer_id: customerExternalId,
        transaction_id: transactionExternalId,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 0,
        },
      };

      // Send 10 concurrent requests with the same idempotency key
      const responses = await Promise.all(
        Array(10).fill(null).map(() =>
          app.inject({
            method: 'POST',
            url: '/api/v1/issues',
            payload,
          })
        )
      );

      // Count successful (201) and conflict (409) responses
      const created = responses.filter((r) => r.statusCode === 201);
      const conflicts = responses.filter((r) => r.statusCode === 409);

      // Exactly one request should succeed
      expect(created.length).toBe(1);
      // The rest should get 409 Conflict
      expect(conflicts.length).toBe(9);

      // Verify only one issue exists in the database
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issues)
        .where(sql`idempotency_key = ${idempotencyKey}`);

      expect(result[0]?.count).toBe(1);
    });

    it('should allow different idempotency keys concurrently', async () => {
      // Send 5 concurrent requests with different idempotency keys
      const responses = await Promise.all(
        Array(5).fill(null).map((_, i) =>
          app.inject({
            method: 'POST',
            url: '/api/v1/issues',
            payload: {
              idempotency_key: `different-key-${Date.now()}-${i}`,
              type: 'decline',
              customer_id: customerExternalId,
              transaction_id: transactionExternalId,
              details: {
                error_code: 'insufficient_funds',
                auto_retry_count: i,
              },
            },
          })
        )
      );

      // All requests should succeed
      const created = responses.filter((r) => r.statusCode === 201);
      expect(created.length).toBe(5);

      // Verify all issues exist in the database
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issues);

      expect(result[0]?.count).toBe(5);
    });
  });


  describe('Large Payload Handling', () => {
    let app: FastifyInstance;
    let customerExternalId: string;
    let transactionExternalId: string;

    beforeEach(async () => {
      app = await buildApp();
      const customer = await seedTestCustomer();
      customerExternalId = customer.externalId;
      const transaction = await seedTestTransaction(customer.id);
      transactionExternalId = transaction.externalId;
    });

    it('should reject excessively long idempotency key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/issues',
        payload: {
          idempotency_key: 'x'.repeat(200), // Exceeds 100 char limit
          type: 'decline',
          customer_id: customerExternalId,
          transaction_id: transactionExternalId,
          details: {
            error_code: 'insufficient_funds',
            auto_retry_count: 0,
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
