/**
 * Script to process sample payment issues through the decision engine.
 *
 * Usage:
 *   npm run process-samples
 *   npm run process-samples -- --mode=ai    (use AI engine)
 *   npm run process-samples -- --mode=rules (use rules engine)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config/index.js';
import { evaluate, shouldAutoResolve } from '../src/services/decisionEngineRouter.js';
import type { Issue, Customer, Transaction } from '../src/db/schema/index.js';
import type { IssueType, PriorityLevel, IssueStatus } from '../src/db/schema/enums.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sample data interfaces (matching JSON structure)
interface SampleCustomer {
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
  risk_score: 'low' | 'medium' | 'high';
}

interface SampleTransaction {
  id: string;
  customer_id: string;
  merchant: string;
  amount: number;
  payment_method: string;
  status: string;
  failure_reason?: string;
  created_at: string;
  is_recurring?: boolean;
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
    last_update?: string;
  };
}

interface SampleIssue {
  id: string;
  type: string;
  transaction_id: string;
  customer_id: string;
  error_code?: string;
  amount?: number;
  merchant?: string;
  created_at: string;
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

// Load sample data
function loadSampleData() {
  const dataDir = join(__dirname, '..', '..', 'sample_data');

  const customers: SampleCustomer[] = JSON.parse(
    readFileSync(join(dataDir, 'customers.json'), 'utf-8')
  );

  const transactions: SampleTransaction[] = JSON.parse(
    readFileSync(join(dataDir, 'transactions.json'), 'utf-8')
  );

  const issues: SampleIssue[] = JSON.parse(
    readFileSync(join(dataDir, 'payment_issues.json'), 'utf-8')
  );

  return { customers, transactions, issues };
}

// Convert sample customer to database format
function toDbCustomer(sample: SampleCustomer): Customer {
  return {
    id: sample.id,
    externalId: sample.id,
    emailEncrypted: '[encrypted]',
    nameEncrypted: '[encrypted]',
    accountCreated: sample.account_created,
    lifetimeTransactions: sample.lifetime_transactions,
    lifetimeSpend: sample.lifetime_spend.toString(),
    successfulPayments: sample.successful_payments,
    failedPayments: sample.failed_payments,
    disputesFiled: sample.disputes_filed,
    disputesWon: sample.disputes_won,
    currentInstallmentPlans: sample.current_installment_plans,
    riskScore: sample.risk_score,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Convert sample transaction to database format
function toDbTransaction(sample: SampleTransaction): Transaction {
  return {
    id: sample.id,
    externalId: sample.id,
    customerId: sample.customer_id,
    merchant: sample.merchant,
    amount: sample.amount.toString(),
    paymentMethodEncrypted: '[encrypted]',
    status: sample.status as 'failed' | 'completed' | 'active_installment' | 'refunded',
    failureReason: sample.failure_reason ?? null,
    isRecurring: sample.is_recurring ?? false,
    installmentPlan: sample.installment_plan
      ? {
          totalInstallments: sample.installment_plan.total_installments,
          completed: sample.installment_plan.installments_paid,
          remaining: sample.installment_plan.total_installments - sample.installment_plan.installments_paid,
        }
      : null,
    shippingInfo: sample.shipping
      ? {
          carrier: sample.shipping.carrier,
          trackingNumber: sample.shipping.tracking_number,
          status: sample.shipping.status as 'pending' | 'in_transit' | 'delivered' | 'lost',
        }
      : null,
    createdAt: new Date(sample.created_at),
    updatedAt: new Date(),
  };
}

// Convert sample issue to database format
function toDbIssue(sample: SampleIssue): Issue {
  let details: Record<string, unknown> = {};

  switch (sample.type) {
    case 'decline':
      details = {
        error_code: sample.error_code,
        auto_retry_count: sample.auto_retry_count ?? 0,
      };
      break;
    case 'missed_installment':
      details = {
        installment_number: sample.installment_number,
        total_installments: sample.installments_total,
        amount_due: sample.amount_due,
        days_overdue: sample.days_overdue,
      };
      break;
    case 'dispute':
      details = {
        reason: sample.reason,
        days_since_purchase: sample.days_since_purchase,
      };
      break;
    case 'refund_request':
      details = {
        reason: sample.reason,
        days_since_purchase: sample.days_since_purchase,
      };
      break;
  }

  return {
    id: sample.id,
    externalId: sample.id,
    idempotencyKey: null,
    type: sample.type as IssueType,
    customerId: sample.customer_id,
    transactionId: sample.transaction_id,
    details: details as Issue['details'],
    status: 'pending' as IssueStatus,
    priority: 'normal' as PriorityLevel,
    retryCount: 0,
    lastRetryAt: null,
    automatedDecision: null,
    automatedDecisionConfidence: null,
    automatedDecisionReason: null,
    humanDecision: null,
    humanDecisionReason: null,
    humanReviewerEmail: null,
    humanReviewedAt: null,
    finalResolution: null,
    resolutionReason: null,
    resolvedAt: null,
    createdAt: new Date(sample.created_at),
    updatedAt: new Date(),
  };
}

// Get routing label based on confidence
function getRouting(confidence: number, autoResolve: boolean): string {
  if (autoResolve) {
    return 'auto_resolve';
  }
  const thresholdHigh = config.decisionEngine.autoResolveThreshold;
  const thresholdLow = config.decisionEngine.humanReviewThreshold;

  if (confidence * 100 >= thresholdHigh) {
    return 'auto_resolve';
  } else if (confidence * 100 >= thresholdLow) {
    return 'human_review';
  }
  return 'escalate';
}

// Main processing function
async function processIssues() {
  console.log('\n=== Payment Issue Processing Demo ===\n');
  console.log(`Decision Engine Mode: ${config.decisionEngine.mode.toUpperCase()}`);
  console.log(`Auto-resolve threshold: ${config.decisionEngine.autoResolveThreshold}%`);
  console.log(`Human review threshold: ${config.decisionEngine.humanReviewThreshold}%`);
  console.log('');

  const { customers, transactions, issues } = loadSampleData();

  // Create lookup maps
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const transactionMap = new Map(transactions.map((t) => [t.id, t]));

  // Results table
  const results: Array<{
    issueId: string;
    type: string;
    decision: string;
    confidence: string;
    routing: string;
    reason: string;
  }> = [];

  // Process each issue
  for (const sampleIssue of issues) {
    const sampleCustomer = customerMap.get(sampleIssue.customer_id);
    const sampleTransaction = transactionMap.get(sampleIssue.transaction_id);

    if (!sampleCustomer || !sampleTransaction) {
      console.error(`Missing data for issue ${sampleIssue.id}`);
      continue;
    }

    const issue = toDbIssue(sampleIssue);
    const customer = toDbCustomer(sampleCustomer);
    const transaction = toDbTransaction(sampleTransaction);

    try {
      const decision = await evaluate(issue, customer, transaction);
      const autoResolve = shouldAutoResolve(decision);
      const routing = getRouting(decision.confidence, autoResolve);

      results.push({
        issueId: sampleIssue.id,
        type: sampleIssue.type,
        decision: decision.decision,
        confidence: `${(decision.confidence * 100).toFixed(0)}%`,
        routing,
        reason: decision.reason.substring(0, 50) + (decision.reason.length > 50 ? '...' : ''),
      });
    } catch (error) {
      console.error(`Error processing issue ${sampleIssue.id}:`, error);
      results.push({
        issueId: sampleIssue.id,
        type: sampleIssue.type,
        decision: 'ERROR',
        confidence: 'N/A',
        routing: 'failed',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Print results table
  console.log('\n=== Processing Results ===\n');

  // Header
  console.log(
    '| Issue ID  | Type               | Decision      | Confidence | Routing       |'
  );
  console.log(
    '|-----------|--------------------|--------------:|:----------:|---------------|'
  );

  // Rows
  for (const r of results) {
    console.log(
      `| ${r.issueId.padEnd(9)} | ${r.type.padEnd(18)} | ${r.decision.padStart(12)} | ${r.confidence.padStart(10)} | ${r.routing.padEnd(13)} |`
    );
  }

  console.log('');

  // Summary
  const autoResolved = results.filter((r) => r.routing === 'auto_resolve').length;
  const humanReview = results.filter((r) => r.routing === 'human_review').length;
  const escalated = results.filter((r) => r.routing === 'escalate').length;
  const failed = results.filter((r) => r.routing === 'failed').length;

  console.log('=== Summary ===');
  console.log(`Total issues: ${results.length}`);
  console.log(`  Auto-resolved: ${autoResolved}`);
  console.log(`  Human review:  ${humanReview}`);
  console.log(`  Escalated:     ${escalated}`);
  if (failed > 0) {
    console.log(`  Failed:        ${failed}`);
  }
  console.log('');

  // Detailed reasoning
  console.log('=== Detailed Reasoning ===\n');
  for (const r of results) {
    console.log(`${r.issueId} (${r.type}):`);
    console.log(`  Decision: ${r.decision} (${r.confidence} confidence)`);
    console.log(`  Routing:  ${r.routing}`);
    console.log(`  Reason:   ${r.reason}`);
    console.log('');
  }
}

// Run
processIssues().catch(console.error);
