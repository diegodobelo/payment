import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions, type Transaction } from '../db/schema/index.js';
import { decrypt } from '../lib/encryption.js';
import { logPiiAccess } from './auditLogRepository.js';
import type { AuditContext } from './customerRepository.js';

/**
 * Transaction with decrypted payment method.
 */
export interface DecryptedTransaction
  extends Omit<Transaction, 'paymentMethodEncrypted'> {
  paymentMethod: string;
}

/**
 * Convert a database transaction to a decrypted transaction object.
 */
function decryptTransaction(transaction: Transaction): DecryptedTransaction {
  const { paymentMethodEncrypted, ...rest } = transaction;
  return {
    ...rest,
    paymentMethod: decrypt(paymentMethodEncrypted),
  };
}

/**
 * Helper to build log params with proper optional property handling.
 */
function buildLogParams(
  entityId: string,
  audit: AuditContext
): Parameters<typeof logPiiAccess>[0] {
  const logParams: Parameters<typeof logPiiAccess>[0] = {
    entityType: 'transaction',
    entityId,
    actor: audit.actor,
    piiFieldsAccessed: ['paymentMethod'],
  };
  if (audit.actorIp !== undefined) logParams.actorIp = audit.actorIp;
  if (audit.requestId !== undefined) logParams.requestId = audit.requestId;
  return logParams;
}

/**
 * Find a transaction by internal UUID.
 * When audit context is provided, payment method access is logged.
 */
export async function findById(
  id: string,
  audit?: AuditContext
): Promise<DecryptedTransaction | null> {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id));

  if (result.length === 0) {
    return null;
  }

  const transaction = result[0]!;

  // Log PII access when audit context is provided
  if (audit) {
    await logPiiAccess(buildLogParams(id, audit));
  }

  return decryptTransaction(transaction);
}

/**
 * Find a transaction by external ID (e.g., "txn_5521").
 * When audit context is provided, payment method access is logged.
 */
export async function findByExternalId(
  externalId: string,
  audit?: AuditContext
): Promise<DecryptedTransaction | null> {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.externalId, externalId));

  if (result.length === 0) {
    return null;
  }

  const transaction = result[0]!;

  // Log PII access when audit context is provided
  if (audit) {
    await logPiiAccess(buildLogParams(transaction.id, audit));
  }

  return decryptTransaction(transaction);
}

/**
 * Find all transactions for a customer.
 * When audit context is provided, payment method access is logged for each transaction.
 */
export async function findByCustomerId(
  customerId: string,
  audit?: AuditContext
): Promise<DecryptedTransaction[]> {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.customerId, customerId));

  if (result.length === 0) {
    return [];
  }

  // Log PII access for all transactions
  if (audit) {
    for (const transaction of result) {
      await logPiiAccess(buildLogParams(transaction.id, audit));
    }
  }

  return result.map(decryptTransaction);
}

/**
 * Find a transaction by internal UUID without decrypting payment method.
 * Use this when you only need non-sensitive data (e.g., amount, status).
 */
export async function findByIdWithoutPii(id: string): Promise<Transaction | null> {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id));
  return result[0] ?? null;
}

/**
 * Find a transaction by external ID without decrypting payment method.
 * Use this when you only need non-sensitive data (e.g., amount, status).
 */
export async function findByExternalIdWithoutPii(
  externalId: string
): Promise<Transaction | null> {
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.externalId, externalId));
  return result[0] ?? null;
}

export const transactionRepository = {
  findById,
  findByExternalId,
  findByCustomerId,
  findByIdWithoutPii,
  findByExternalIdWithoutPii,
};
