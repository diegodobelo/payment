import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { customers, type Customer } from '../db/schema/index.js';
import { decrypt } from '../lib/encryption.js';
import { logPiiAccess, type LogPiiAccessParams } from './auditLogRepository.js';

/**
 * Customer with decrypted PII fields.
 */
export interface DecryptedCustomer extends Omit<Customer, 'emailEncrypted' | 'nameEncrypted'> {
  email: string;
  name: string;
}

/**
 * Context for audit logging.
 */
export interface AuditContext {
  actor: string;
  actorIp?: string;
  requestId?: string;
}

/**
 * Convert a database customer to a decrypted customer object.
 */
function decryptCustomer(customer: Customer): DecryptedCustomer {
  const { emailEncrypted, nameEncrypted, ...rest } = customer;
  return {
    ...rest,
    email: decrypt(emailEncrypted),
    name: decrypt(nameEncrypted),
  };
}

/**
 * Find a customer by internal UUID.
 * When audit context is provided, PII access is logged.
 */
export async function findById(
  id: string,
  audit?: AuditContext
): Promise<DecryptedCustomer | null> {
  const result = await db.select().from(customers).where(eq(customers.id, id));

  if (result.length === 0) {
    return null;
  }

  const customer = result[0]!;

  // Log PII access when audit context is provided
  if (audit) {
    const logParams: LogPiiAccessParams = {
      entityType: 'customer',
      entityId: id,
      actor: audit.actor,
      piiFieldsAccessed: ['email', 'name'],
    };
    if (audit.actorIp !== undefined) logParams.actorIp = audit.actorIp;
    if (audit.requestId !== undefined) logParams.requestId = audit.requestId;
    await logPiiAccess(logParams);
  }

  return decryptCustomer(customer);
}

/**
 * Find a customer by external ID (e.g., "cust_042").
 * When audit context is provided, PII access is logged.
 */
export async function findByExternalId(
  externalId: string,
  audit?: AuditContext
): Promise<DecryptedCustomer | null> {
  const result = await db
    .select()
    .from(customers)
    .where(eq(customers.externalId, externalId));

  if (result.length === 0) {
    return null;
  }

  const customer = result[0]!;

  // Log PII access when audit context is provided
  if (audit) {
    const logParams: LogPiiAccessParams = {
      entityType: 'customer',
      entityId: customer.id,
      actor: audit.actor,
      piiFieldsAccessed: ['email', 'name'],
    };
    if (audit.actorIp !== undefined) logParams.actorIp = audit.actorIp;
    if (audit.requestId !== undefined) logParams.requestId = audit.requestId;
    await logPiiAccess(logParams);
  }

  return decryptCustomer(customer);
}

/**
 * Find a customer by internal UUID without decrypting PII.
 * Use this when you only need non-sensitive data (e.g., risk score, transaction history).
 */
export async function findByIdWithoutPii(id: string): Promise<Customer | null> {
  const result = await db.select().from(customers).where(eq(customers.id, id));
  return result[0] ?? null;
}

/**
 * Find a customer by external ID without decrypting PII.
 * Use this when you only need non-sensitive data (e.g., risk score, transaction history).
 */
export async function findByExternalIdWithoutPii(
  externalId: string
): Promise<Customer | null> {
  const result = await db
    .select()
    .from(customers)
    .where(eq(customers.externalId, externalId));
  return result[0] ?? null;
}

export const customerRepository = {
  findById,
  findByExternalId,
  findByIdWithoutPii,
  findByExternalIdWithoutPii,
};
