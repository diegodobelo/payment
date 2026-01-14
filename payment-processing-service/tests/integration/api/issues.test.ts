import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, seedTestCustomer, seedTestTransaction } from '../../helpers.js';

describe('POST /api/v1/issues', () => {
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

  it('should create an issue and return 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload: {
        type: 'decline',
        customer_id: customerExternalId,
        transaction_id: transactionExternalId,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 1,
        },
        priority: 'normal',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.external_id).toMatch(/^iss_/);
    expect(body.status).toBe('pending');
  });

  it('should return 409 for duplicate idempotency key', async () => {
    const payload = {
      idempotency_key: 'test-idempotency-123',
      type: 'decline',
      customer_id: customerExternalId,
      transaction_id: transactionExternalId,
      details: {
        error_code: 'insufficient_funds',
        auto_retry_count: 0,
      },
    };

    // First request should succeed
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload,
    });
    expect(first.statusCode).toBe(201);

    // Second request with same idempotency key should return 409
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
  });

  it('should return 404 for non-existent customer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload: {
        type: 'decline',
        customer_id: 'non_existent_customer',
        transaction_id: transactionExternalId,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 0,
        },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('should return 400 for invalid details', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload: {
        type: 'decline',
        customer_id: customerExternalId,
        transaction_id: transactionExternalId,
        details: {
          // Missing required error_code
          auto_retry_count: 0,
        },
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/v1/issues/:id', () => {
  let app: FastifyInstance;
  let issueId: string;

  beforeEach(async () => {
    app = await buildApp();
    const customer = await seedTestCustomer();
    const transaction = await seedTestTransaction(customer.id);

    // Create an issue
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      payload: {
        type: 'decline',
        customer_id: customer.externalId,
        transaction_id: transaction.externalId,
        details: {
          error_code: 'insufficient_funds',
          auto_retry_count: 1,
        },
      },
    });
    issueId = createResponse.json().id;
  });

  it('should return issue details', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issueId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(issueId);
    expect(body.type).toBe('decline');
    expect(body.details.error_code).toBe('insufficient_funds');
    expect(body.processing_history).toBeInstanceOf(Array);
  });

  it('should return 404 for non-existent issue', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/issues/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/v1/issues', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    const customer = await seedTestCustomer();
    const transaction = await seedTestTransaction(customer.id);

    // Create multiple issues
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/issues',
        payload: {
          type: i === 0 ? 'decline' : 'dispute',
          customer_id: customer.externalId,
          transaction_id: transaction.externalId,
          details: i === 0
            ? { error_code: 'insufficient_funds', auto_retry_count: 0 }
            : { reason: 'item_not_received', days_since_purchase: 10 },
          priority: i === 2 ? 'high' : 'normal',
        },
      });
    }
  });

  it('should list all issues', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/issues',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(3);
    expect(body.pagination.total).toBe(3);
  });

  it('should filter by type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/issues?type=decline',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('decline');
  });

  it('should filter by priority', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/issues?priority=high',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].priority).toBe('high');
  });

  it('should paginate results', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/issues?limit=2&page=1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total_pages).toBe(2);
  });
});
