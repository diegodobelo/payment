import Fastify from 'fastify';
import cors from '@fastify/cors';
import { db } from '../src/db/client.js';
import { customers, transactions } from '../src/db/schema/index.js';
import { encrypt } from '../src/lib/encryption.js';
import { errorHandler } from '../src/api/middleware/errorHandler.js';
import { requestIdHook } from '../src/api/middleware/requestId.js';
import { healthRoutes } from '../src/api/routes/health.routes.js';
import { issueRoutes } from '../src/api/routes/issues.routes.js';
import { analyticsRoutes } from '../src/api/routes/analytics.routes.js';
import { auditLogsRoutes } from '../src/api/routes/audit-logs.routes.js';

// AI Mock Response Types
export interface AIResponseData {
  decision: 'auto_resolve' | 'human_review' | 'escalate';
  action: 'retry_payment' | 'block_card' | 'approve_refund' | 'deny_refund' |
          'accept_dispute' | 'contest_dispute' | 'send_reminder' | 'charge_late_fee' | 'escalate';
  confidence: number;
  reasoning?: string;
  policyApplied?: string;
}

/**
 * Create a mock AI SDK response with customizable fields.
 */
export function createMockAIResponse(overrides?: Partial<AIResponseData>): {
  type: string;
  result: string;
} {
  const defaultData: AIResponseData = {
    decision: 'auto_resolve',
    action: 'retry_payment',
    confidence: 85,
    reasoning: 'Test AI reasoning',
    policyApplied: 'test_policy',
  };

  return {
    type: 'result',
    result: JSON.stringify({ ...defaultData, ...overrides }),
  };
}

/**
 * Create a mock AI SDK response with raw result string (for testing parsing).
 */
export function createMockAIResponseRaw(resultString: string): {
  type: string;
  result: string;
} {
  return {
    type: 'result',
    result: resultString,
  };
}

/**
 * Create a mock AI SDK error response.
 */
export function createMockAIError(message: string): {
  type: string;
  error: Error;
} {
  return {
    type: 'result',
    error: new Error(message),
  };
}

/**
 * Build a test Fastify app with all routes registered.
 */
export async function buildApp() {
  const app = Fastify({
    logger: false, // Disable logging during tests
  });

  await app.register(cors);
  app.addHook('onRequest', requestIdHook);
  app.setErrorHandler(errorHandler as Parameters<typeof app.setErrorHandler>[0]);
  await app.register(healthRoutes);
  await app.register(issueRoutes, { prefix: '/api/v1' });
  await app.register(analyticsRoutes, { prefix: '/api/v1' });
  await app.register(auditLogsRoutes, { prefix: '/api/v1' });

  return app;
}

/**
 * Seed a test customer.
 */
export async function seedTestCustomer(data?: Partial<{
  externalId: string;
  email: string;
  name: string;
  riskScore: 'low' | 'medium' | 'high';
  successfulPayments: number;
  lifetimeTransactions: number;
}>) {
  const externalId = data?.externalId ?? `cust_test_${Date.now()}`;
  const email = data?.email ?? 'test@example.com';
  const name = data?.name ?? 'Test Customer';

  const result = await db.insert(customers).values({
    externalId,
    emailEncrypted: encrypt(email),
    nameEncrypted: encrypt(name),
    accountCreated: '2024-01-01',
    lifetimeTransactions: data?.lifetimeTransactions ?? 10,
    lifetimeSpend: '500.00',
    successfulPayments: data?.successfulPayments ?? 8,
    failedPayments: 2,
    disputesFiled: 0,
    disputesWon: 0,
    currentInstallmentPlans: 0,
    riskScore: data?.riskScore ?? 'low',
  }).returning();

  return { ...result[0]!, externalId };
}

/**
 * Seed a test transaction.
 */
export async function seedTestTransaction(
  customerId: string,
  data?: Partial<{
    externalId: string;
    status: 'failed' | 'completed' | 'active_installment' | 'refunded';
    isRecurring: boolean;
  }>
) {
  const externalId = data?.externalId ?? `txn_test_${Date.now()}`;

  const result = await db.insert(transactions).values({
    externalId,
    customerId,
    merchant: 'Test Merchant',
    amount: '99.99',
    status: data?.status ?? 'failed',
    paymentMethodEncrypted: encrypt('card_visa_4242'),
    failureReason: 'insufficient_funds',
    isRecurring: data?.isRecurring ?? false,
  }).returning();

  return { ...result[0]!, externalId };
}
