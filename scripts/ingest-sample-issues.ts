/**
 * Script to ingest sample payment issues through the full API pipeline.
 *
 * This demonstrates the end-to-end flow:
 *   1. Seed customers and transactions (if not present)
 *   2. Create issues via API (which queues them for processing)
 *   3. Wait for queue processing to complete
 *   4. Display results showing decision, confidence, and routing
 *
 * Prerequisites:
 *   - docker-compose up -d (PostgreSQL + Redis)
 *   - npm run dev (API server in one terminal)
 *   - npm run worker:dev (Worker in another terminal)
 *
 * Usage:
 *   npm run ingest-samples              # Run with existing data
 *   npm run ingest-samples -- -c        # Clear database first
 *   npm run ingest-samples -- --clear   # Clear database first
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { eq, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client.js';
import { redis, closeRedis } from '../src/lib/redis.js';
import { customers, transactions } from '../src/db/schema/index.js';
import { encrypt } from '../src/lib/encryption.js';
import { config } from '../src/config/index.js';
import type { RiskScore, TransactionStatus, InstallmentPlan, ShippingInfo } from '../src/db/schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const API_BASE_URL = `http://localhost:${config.port}`;
const POLL_INTERVAL_MS = 2000;  // Poll every 2 seconds
const MAX_POLL_TIME_MS = 120000; // Wait up to 2 minutes

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
  };
  is_recurring?: boolean;
}

interface RawIssue {
  id: string;
  type: string;
  transaction_id: string;
  customer_id: string;
  created_at: string;
  error_code?: string;
  auto_retry_count?: number;
  installment_number?: number;
  installments_total?: number;
  amount_due?: number;
  days_overdue?: number;
  reason?: string;
  days_since_purchase?: number;
  installment_plan?: boolean;
  installments_paid?: number;
  is_recurring?: boolean;
}

interface ProcessingHistoryEntry {
  from_status: string | null;
  to_status: string;
  changed_by: string;
  reason: string | null;
  timestamp: string;
}

interface IssueResponse {
  id: string;
  external_id: string;
  type: string;
  status: string;
  priority: string;
  automated_decision: {
    decision: string;
    confidence: number;
    reason: string;
  } | null;
  final_resolution: string | null;
  processing_history: ProcessingHistoryEntry[];
}

// ID mappings (external_id -> UUID)
const customerIdMap = new Map<string, string>();
const transactionIdMap = new Map<string, string>();

/**
 * Load sample data from JSON files.
 */
function loadSampleData() {
  const sampleDataPath = join(__dirname, '../sample_data');

  const customersData: RawCustomer[] = JSON.parse(
    readFileSync(join(sampleDataPath, 'customers.json'), 'utf-8')
  );

  const transactionsData: RawTransaction[] = JSON.parse(
    readFileSync(join(sampleDataPath, 'transactions.json'), 'utf-8')
  );

  const issuesData: RawIssue[] = JSON.parse(
    readFileSync(join(sampleDataPath, 'payment_issues.json'), 'utf-8')
  );

  return { customersData, transactionsData, issuesData };
}

/**
 * Seed customers into the database (skip if already exist).
 */
async function seedCustomers(data: RawCustomer[]): Promise<void> {
  console.log('\n📥 Seeding customers...');

  for (const raw of data) {
    // Check if customer already exists
    const existing = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.externalId, raw.id))
      .limit(1);

    if (existing.length > 0) {
      customerIdMap.set(raw.id, existing[0].id);
      console.log(`   ✓ Customer ${raw.id} already exists`);
      continue;
    }

    // Encrypt PII and insert
    const [inserted] = await db
      .insert(customers)
      .values({
        externalId: raw.id,
        emailEncrypted: encrypt(raw.email),
        nameEncrypted: encrypt(raw.name),
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
      console.log(`   + Created customer: ${raw.id}`);
    }
  }
}

/**
 * Seed transactions into the database (skip if already exist).
 */
async function seedTransactions(data: RawTransaction[]): Promise<void> {
  console.log('\n📥 Seeding transactions...');

  for (const raw of data) {
    const customerId = customerIdMap.get(raw.customer_id);
    if (!customerId) {
      console.log(`   ⚠ Skipping transaction ${raw.id}: customer ${raw.customer_id} not found`);
      continue;
    }

    // Check if transaction already exists
    const existing = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.externalId, raw.id))
      .limit(1);

    if (existing.length > 0) {
      transactionIdMap.set(raw.id, existing[0].id);
      console.log(`   ✓ Transaction ${raw.id} already exists`);
      continue;
    }

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
      shippingInfo = {
        carrier: raw.shipping.carrier,
        trackingNumber: raw.shipping.tracking_number,
      };
      if (raw.shipping.status) {
        shippingInfo.status = raw.shipping.status as 'pending' | 'in_transit' | 'delivered' | 'lost';
      }
      const delivery = raw.shipping.estimated_delivery ?? raw.shipping.estimated_ship_date;
      if (delivery) {
        shippingInfo.estimatedDelivery = delivery;
      }
    }

    const [inserted] = await db
      .insert(transactions)
      .values({
        externalId: raw.id,
        customerId,
        merchant: raw.merchant,
        amount: raw.amount.toString(),
        status,
        paymentMethodEncrypted: encrypt(raw.payment_method),
        failureReason: raw.failure_reason ?? null,
        installmentPlan,
        shippingInfo,
        isRecurring: raw.is_recurring ?? false,
      })
      .returning({ id: transactions.id });

    if (inserted) {
      transactionIdMap.set(raw.id, inserted.id);
      console.log(`   + Created transaction: ${raw.id}`);
    }
  }
}

/**
 * Build the API request body for creating an issue.
 */
function buildIssuePayload(raw: RawIssue): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    idempotency_key: raw.id,
    type: raw.type,
    customer_id: raw.customer_id,
    transaction_id: raw.transaction_id,
  };

  // Build type-specific details
  switch (raw.type) {
    case 'decline':
      payload.details = {
        error_code: raw.error_code ?? 'card_declined',
        auto_retry_count: raw.auto_retry_count ?? 0,
      };
      break;
    case 'missed_installment':
      payload.details = {
        installment_number: raw.installment_number ?? 1,
        total_installments: raw.installments_total ?? 1,
        amount_due: raw.amount_due ?? 0,
        days_overdue: raw.days_overdue ?? 0,
      };
      break;
    case 'dispute':
      payload.details = {
        reason: raw.reason ?? 'product_issue',
        days_since_purchase: raw.days_since_purchase ?? 0,
      };
      break;
    case 'refund_request':
      payload.details = {
        reason: raw.reason ?? 'changed_mind',
        days_since_purchase: raw.days_since_purchase ?? 0,
      };
      break;
  }

  return payload;
}

/**
 * Create an issue via the API.
 */
async function createIssue(payload: Record<string, unknown>): Promise<{ id: string; status: string } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 409) {
      // Conflict - issue already exists (idempotency)
      const error = await response.json() as { error?: { details?: { existingId?: string } } };
      return { id: error.error?.details?.existingId ?? 'unknown', status: 'exists' };
    }

    if (!response.ok) {
      const error = await response.json();
      console.error(`   ✗ Failed to create issue: ${JSON.stringify(error)}`);
      return null;
    }

    return await response.json() as { id: string; status: string };
  } catch (error) {
    console.error(`   ✗ API request failed:`, error);
    return null;
  }
}

/**
 * Get an issue by ID from the API.
 */
async function getIssue(id: string): Promise<IssueResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/issues/${id}`);
    if (!response.ok) {
      return null;
    }
    return await response.json() as IssueResponse;
  } catch {
    return null;
  }
}

/**
 * Wait for an issue to finish processing.
 */
async function waitForProcessing(id: string): Promise<IssueResponse | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const issue = await getIssue(id);
    if (!issue) {
      return null;
    }

    // Check if processing is complete
    if (issue.status !== 'pending' && issue.status !== 'processing') {
      return issue;
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Timeout - return last known state
  return await getIssue(id);
}

/**
 * Get routing label based on confidence and thresholds.
 */
function getRouting(confidence: number | null, status: string): string {
  if (status === 'resolved') {
    return 'auto_resolve';
  }
  if (status === 'awaiting_review') {
    return 'human_review';
  }
  if (status === 'failed') {
    return 'failed';
  }

  if (confidence === null) {
    return 'unknown';
  }

  const thresholdHigh = config.decisionEngine.autoResolveThreshold;
  const thresholdLow = config.decisionEngine.humanReviewThreshold;

  if (confidence >= thresholdHigh) {
    return 'auto_resolve';
  } else if (confidence >= thresholdLow) {
    return 'human_review';
  }
  return 'escalate';
}

/**
 * Clear database tables and Redis (for fresh start).
 */
async function clearDatabase(): Promise<void> {
  console.log('\n🗑️  Clearing database...');
  // Truncate in correct order due to foreign keys
  await db.execute(sql`TRUNCATE status_history CASCADE`);
  await db.execute(sql`TRUNCATE audit_logs CASCADE`);
  await db.execute(sql`TRUNCATE issues CASCADE`);
  await db.execute(sql`TRUNCATE transactions CASCADE`);
  await db.execute(sql`TRUNCATE customers CASCADE`);
  // Clear Redis
  await redis.flushdb();
  // Clear ID mappings
  customerIdMap.clear();
  transactionIdMap.clear();
  console.log('   ✓ Database cleared');
}

/**
 * Main function.
 */
async function main(): Promise<void> {
  // Parse command-line args
  const args = process.argv.slice(2);
  const shouldClear = args.includes('-c') || args.includes('--clear');
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Payment Issue Ingestion - End-to-End Pipeline          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\nConfiguration:`);
  console.log(`  Decision Engine Mode: ${config.decisionEngine.mode.toUpperCase()}`);
  console.log(`  Auto-resolve threshold: ${config.decisionEngine.autoResolveThreshold}%`);
  console.log(`  Human review threshold: ${config.decisionEngine.humanReviewThreshold}%`);
  console.log(`  API URL: ${API_BASE_URL}`);

  // Check if API is available
  try {
    const healthResponse = await fetch(`${API_BASE_URL}/health/live`);
    if (!healthResponse.ok) {
      throw new Error('Health check failed');
    }
    console.log(`  API Status: ✓ Running`);
  } catch {
    console.error('\n❌ Error: API server is not running.');
    console.error('   Please start the server with: npm run dev');
    process.exit(1);
  }

  // Clear database if requested
  if (shouldClear) {
    await clearDatabase();
  }

  // Load sample data
  const { customersData, transactionsData, issuesData } = loadSampleData();
  console.log(`\nLoaded ${customersData.length} customers, ${transactionsData.length} transactions, ${issuesData.length} issues`);

  // Seed prerequisites
  await seedCustomers(customersData);
  await seedTransactions(transactionsData);

  // Create issues via API
  console.log('\n📤 Creating issues via API (queued for processing)...');
  const createdIssues: Array<{ externalId: string; id: string; type: string }> = [];

  for (const raw of issuesData) {
    const payload = buildIssuePayload(raw);
    const result = await createIssue(payload);

    if (result) {
      createdIssues.push({ externalId: raw.id, id: result.id, type: raw.type });
      if (result.status === 'exists') {
        console.log(`   ✓ Issue ${raw.id} already exists (idempotency)`);
      } else {
        console.log(`   + Created issue: ${raw.id} -> ${result.id}`);
      }
    }
  }

  // Wait for processing (parallel)
  console.log('\n⏳ Processing issues in parallel...\n');

  // Show initial status for all issues
  for (const issue of createdIssues) {
    console.log(`   ${issue.externalId}: ⏳ waiting...`);
  }

  // Process all in parallel, logging as each completes
  const resultsWithNulls = await Promise.all(
    createdIssues.map(async (issue) => {
      const processed = await waitForProcessing(issue.id);
      const status = processed ? `✓ ${processed.status}` : '✗ timeout';
      console.log(`   ${issue.externalId}: ${status}`);
      return processed;
    })
  );

  const results = resultsWithNulls.filter((r): r is IssueResponse => r !== null);

  // Display results
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           Processing Results                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('┌────────────────────┬────────────────────┬──────────────────┬────────────┬───────────────┐');
  console.log('│ Issue ID           │ Type               │ Decision         │ Confidence │ Routing       │');
  console.log('├────────────────────┼────────────────────┼──────────────────┼────────────┼───────────────┤');

  for (const r of results) {
    const decision = r.automated_decision?.decision ?? 'N/A';
    const confidence = r.automated_decision?.confidence
      ? `${(r.automated_decision.confidence * 100).toFixed(0)}%`
      : 'N/A';
    const routing = getRouting(
      r.automated_decision?.confidence ? r.automated_decision.confidence * 100 : null,
      r.status
    );

    console.log(
      `│ ${r.external_id.padEnd(18)} │ ${r.type.padEnd(18)} │ ${decision.padStart(16)} │ ${confidence.padStart(10)} │ ${routing.padEnd(13)} │`
    );
  }

  console.log('└────────────────────┴────────────────────┴──────────────────┴────────────┴───────────────┘');

  // Summary
  const autoResolved = results.filter((r) => r.status === 'resolved').length;
  const humanReview = results.filter((r) => r.status === 'awaiting_review').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log('\n📊 Summary:');
  console.log(`   Total issues:   ${results.length}`);
  console.log(`   Auto-resolved:  ${autoResolved}`);
  console.log(`   Human review:   ${humanReview}`);
  if (failed > 0) {
    console.log(`   Failed:         ${failed}`);
  }

  // Detailed reasoning
  console.log('\n📝 Detailed Reasoning:\n');
  for (const r of results) {
    console.log(`${r.external_id} (${r.type}):`);
    if (r.automated_decision) {
      console.log(`   Decision:   ${r.automated_decision.decision}`);
      console.log(`   Confidence: ${(r.automated_decision.confidence * 100).toFixed(0)}%`);
      console.log(`   Reason:     ${r.automated_decision.reason}`);
    } else {
      console.log(`   No automated decision recorded`);
    }
    console.log(`   Status:     ${r.status}`);
    if (r.final_resolution) {
      console.log(`   Resolution: ${r.final_resolution}`);
    }

    // Processing history
    if (r.processing_history && r.processing_history.length > 0) {
      console.log(`\n   Processing History:`);
      for (const h of r.processing_history) {
        const from = h.from_status ?? 'created';
        const reason = h.reason ? ` - ${h.reason}` : '';
        console.log(`     ${from} → ${h.to_status} (${h.changed_by})${reason}`);
      }
    }
    console.log('');
  }

  // Cleanup
  await closeRedis();
  await closeDatabase();
}

// Run
main().catch((error) => {
  console.error('\n❌ Ingestion failed:', error);
  process.exit(1);
});
