import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db, closeDatabase } from './client.js';
import { customers, transactions, issues, statusHistory } from './schema/index.js';
import { encrypt } from '../lib/encryption.js';
import { logger } from '../lib/logger.js';
import type {
  RiskScore,
  TransactionStatus,
  InstallmentPlan,
  ShippingInfo,
  IssueDetails,
  DeclineDetails,
  MissedInstallmentDetails,
  DisputeDetails,
  RefundRequestDetails,
} from './schema/index.js';
import type { IssueType } from './schema/enums.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Types for raw sample data
interface RawCustomer {
  id: string;
  email: string;
  name: string;
  account_created: string;
  lifetime_transactions: number;
  lifetime_spend: number;
  successful_payments: number;
  failed_payments: number;
  disputes_filed: number;
  disputes_won: number;
  current_installment_plans: number;
  risk_score: string;
  notes?: string;
}

interface RawTransaction {
  id: string;
  customer_id: string;
  merchant: string;
  amount: number;
  payment_method: string;
  status: string;
  failure_reason?: string;
  created_at: string;
  installment_plan?: {
    total_installments: number;
    amount_per_installment: number;
    installments_paid: number;
    next_due_date: string;
  } | null;
  shipping?: {
    carrier: string;
    tracking_number: string;
    status: string;
    estimated_delivery?: string;
    estimated_ship_date?: string;
    last_update?: string;
    last_location?: string;
  };
  is_recurring?: boolean;
  subscription?: {
    months_active: number;
    monthly_amount: number;
    next_box_ships: string;
  };
}

interface RawIssue {
  id: string;
  type: string;
  transaction_id: string;
  customer_id: string;
  created_at: string;
  // Decline fields
  error_code?: string;
  auto_retry_count?: number;
  // Missed installment fields
  installment_number?: number;
  installments_total?: number;
  amount_due?: number;
  days_overdue?: number;
  // Dispute fields
  reason?: string;
  days_since_purchase?: number;
  // Refund request fields
  installment_plan?: boolean;
  installments_paid?: number;
  // Common fields
  amount?: number;
  merchant?: string;
  is_recurring?: boolean;
}

// ID mappings (external_id -> UUID)
const customerIdMap = new Map<string, string>();
const transactionIdMap = new Map<string, string>();

async function loadSampleData(): Promise<void> {
  const sampleDataPath = join(__dirname, '../../../sample_data');

  logger.info('Loading sample data from: %s', sampleDataPath);

  // Load JSON files
  const customersData: RawCustomer[] = JSON.parse(
    readFileSync(join(sampleDataPath, 'customers.json'), 'utf-8')
  );

  const transactionsData: RawTransaction[] = JSON.parse(
    readFileSync(join(sampleDataPath, 'transactions.json'), 'utf-8')
  );

  const issuesData: RawIssue[] = JSON.parse(
    readFileSync(join(sampleDataPath, 'payment_issues.json'), 'utf-8')
  );

  logger.info('Found %d customers, %d transactions, %d issues',
    customersData.length, transactionsData.length, issuesData.length);

  // Seed in order: customers -> transactions -> issues
  await seedCustomers(customersData);
  await seedTransactions(transactionsData);
  await seedIssues(issuesData);
}

async function seedCustomers(data: RawCustomer[]): Promise<void> {
  logger.info('Seeding customers...');

  for (const raw of data) {
    // Encrypt PII
    const emailEncrypted = encrypt(raw.email);
    const nameEncrypted = encrypt(raw.name);

    const [inserted] = await db
      .insert(customers)
      .values({
        externalId: raw.id,
        emailEncrypted,
        nameEncrypted,
        accountCreated: raw.account_created,
        lifetimeTransactions: raw.lifetime_transactions,
        lifetimeSpend: raw.lifetime_spend.toString(),
        successfulPayments: raw.successful_payments,
        failedPayments: raw.failed_payments,
        disputesFiled: raw.disputes_filed,
        disputesWon: raw.disputes_won,
        currentInstallmentPlans: raw.current_installment_plans,
        riskScore: raw.risk_score as RiskScore,
      })
      .returning({ id: customers.id });

    if (inserted) {
      customerIdMap.set(raw.id, inserted.id);
      logger.info('  Created customer: %s -> %s', raw.id, inserted.id);
    }
  }

  logger.info('Seeded %d customers', data.length);
}

async function seedTransactions(data: RawTransaction[]): Promise<void> {
  logger.info('Seeding transactions...');

  for (const raw of data) {
    const customerId = customerIdMap.get(raw.customer_id);
    if (!customerId) {
      logger.warn('Customer not found for transaction %s: %s', raw.id, raw.customer_id);
      continue;
    }

    // Encrypt payment method
    const paymentMethodEncrypted = encrypt(raw.payment_method);

    // Map status
    let status: TransactionStatus;
    switch (raw.status) {
      case 'failed':
        status = 'failed';
        break;
      case 'completed':
        status = 'completed';
        break;
      case 'active_installment':
        status = 'active_installment';
        break;
      case 'refunded':
        status = 'refunded';
        break;
      default:
        status = 'completed';
    }

    // Map installment plan
    let installmentPlan: InstallmentPlan | null = null;
    if (raw.installment_plan) {
      installmentPlan = {
        total: raw.installment_plan.total_installments,
        completed: raw.installment_plan.installments_paid,
        amountPer: raw.installment_plan.amount_per_installment,
        nextDue: raw.installment_plan.next_due_date,
      };
    }

    // Map shipping info
    let shippingInfo: ShippingInfo | null = null;
    if (raw.shipping) {
      const info: ShippingInfo = {
        carrier: raw.shipping.carrier,
        trackingNumber: raw.shipping.tracking_number,
      };
      const shippingStatus = raw.shipping.status;
      if (shippingStatus !== undefined && shippingStatus !== null) {
        info.status = shippingStatus as 'pending' | 'in_transit' | 'delivered' | 'lost';
      }
      const delivery = raw.shipping.estimated_delivery ?? raw.shipping.estimated_ship_date;
      if (delivery !== undefined && delivery !== null) {
        info.estimatedDelivery = delivery;
      }
      shippingInfo = info;
    }

    const [inserted] = await db.insert(transactions).values({
      externalId: raw.id,
      customerId,
      merchant: raw.merchant,
      amount: raw.amount.toString(),
      status,
      paymentMethodEncrypted,
      failureReason: raw.failure_reason ?? null,
      installmentPlan,
      shippingInfo,
      isRecurring: raw.is_recurring ?? false,
    }).returning({ id: transactions.id });

    if (inserted) {
      transactionIdMap.set(raw.id, inserted.id);
      logger.info('  Created transaction: %s -> %s', raw.id, inserted.id);
    }
  }

  logger.info('Seeded %d transactions', data.length);
}

async function seedIssues(data: RawIssue[]): Promise<void> {
  logger.info('Seeding issues...');

  for (const raw of data) {
    const customerId = customerIdMap.get(raw.customer_id);
    if (!customerId) {
      logger.warn('Customer not found for issue %s: %s', raw.id, raw.customer_id);
      continue;
    }

    const transactionId = transactionIdMap.get(raw.transaction_id);
    if (!transactionId) {
      logger.warn('Transaction not found for issue %s: %s', raw.id, raw.transaction_id);
      continue;
    }

    // Map issue type and build details
    let issueType: IssueType;
    let details: IssueDetails;

    switch (raw.type) {
      case 'decline':
        issueType = 'decline';
        details = {
          error_code: (raw.error_code ?? 'card_declined') as DeclineDetails['error_code'],
          auto_retry_count: raw.auto_retry_count ?? 0,
        } satisfies DeclineDetails;
        break;

      case 'missed_installment':
        issueType = 'missed_installment';
        details = {
          installment_number: raw.installment_number ?? 1,
          total_installments: raw.installments_total ?? 1,
          amount_due: raw.amount_due ?? 0,
          days_overdue: raw.days_overdue ?? 0,
        } satisfies MissedInstallmentDetails;
        break;

      case 'dispute':
        issueType = 'dispute';
        details = {
          reason: (raw.reason ?? 'product_issue') as DisputeDetails['reason'],
          days_since_purchase: raw.days_since_purchase ?? 0,
        } satisfies DisputeDetails;
        break;

      case 'refund_request':
        issueType = 'refund_request';
        const refundDetails: RefundRequestDetails = {
          reason: (raw.reason ?? 'changed_mind') as RefundRequestDetails['reason'],
          days_since_purchase: raw.days_since_purchase ?? 0,
        };
        if (raw.amount !== undefined) {
          refundDetails.partial_amount = raw.amount;
        }
        details = refundDetails;
        break;

      default:
        logger.warn('Unknown issue type for %s: %s', raw.id, raw.type);
        continue;
    }

    // Insert issue
    const [inserted] = await db.insert(issues).values({
      externalId: raw.id,
      type: issueType,
      status: 'pending',
      priority: 'normal',
      customerId,
      transactionId,
      details,
    }).returning({ id: issues.id });

    if (inserted) {
      // Create initial status history
      await db.insert(statusHistory).values({
        issueId: inserted.id,
        fromStatus: null,
        toStatus: 'pending',
        changedBy: 'system',
        reason: 'Issue created via seed',
      });

      logger.info('  Created issue: %s -> %s', raw.id, inserted.id);
    }
  }

  logger.info('Seeded %d issues', data.length);
}

async function main(): Promise<void> {
  try {
    logger.info('Starting database seed...');

    // Check if data already exists
    const existingCustomers = await db.select({ id: customers.id }).from(customers).limit(1);
    if (existingCustomers.length > 0) {
      logger.warn('Database already contains data. Skipping seed.');
      logger.info('To re-seed, truncate the tables first.');
      return;
    }

    await loadSampleData();

    logger.info('Database seed completed successfully!');
  } catch (error) {
    logger.error({ error }, 'Seed failed');
    throw error;
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
