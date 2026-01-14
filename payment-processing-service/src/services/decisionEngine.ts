import type { Issue, Customer, Transaction } from '../db/schema/index.js';
import type { DecisionType } from '../db/schema/enums.js';
import type {
  DeclineDetails,
  MissedInstallmentDetails,
  DisputeDetails,
  RefundRequestDetails,
} from '../db/schema/issues.js';

/**
 * Decision result from the decision engine.
 */
export interface Decision {
  decision: DecisionType;
  confidence: number;
  reason: string;
}

/**
 * Evaluate a decline issue (insufficient funds, expired card, etc.).
 */
function evaluateDecline(
  issue: Issue,
  customer: Customer,
  transaction: Transaction
): Decision {
  const details = issue.details as DeclineDetails;

  switch (details.error_code) {
    case 'insufficient_funds':
      return evaluateDeclineInsufficientFunds(customer);

    case 'card_expired':
      return evaluateDeclineExpiredCard(customer, transaction);

    case 'card_declined':
      return evaluateDeclineGeneric(customer, details);

    default:
      return {
        decision: 'escalate',
        confidence: 0.5,
        reason: 'Unknown error code - requires manual review',
      };
  }
}

/**
 * Evaluate insufficient funds decline.
 */
function evaluateDeclineInsufficientFunds(customer: Customer): Decision {
  // Low-risk customer with good payment history → auto-retry
  if (customer.riskScore === 'low' && customer.successfulPayments > 5) {
    return {
      decision: 'retry_payment',
      confidence: 0.85,
      reason: 'Low-risk customer with strong payment history - scheduling retry',
    };
  }

  // Medium-risk customer with decent history
  if (customer.riskScore === 'medium' && customer.successfulPayments > 10) {
    return {
      decision: 'retry_payment',
      confidence: 0.7,
      reason: 'Medium-risk customer with established payment history - scheduling retry',
    };
  }

  // High-risk or new customer → needs review
  return {
    decision: 'escalate',
    confidence: 0.5,
    reason: 'Customer risk profile requires manual review before retry',
  };
}

/**
 * Evaluate expired card decline.
 */
function evaluateDeclineExpiredCard(
  customer: Customer,
  transaction: Transaction
): Decision {
  // Loyal recurring customer → approve retry (they'll update card)
  if (transaction.isRecurring && customer.lifetimeTransactions > 10) {
    return {
      decision: 'retry_payment',
      confidence: 0.9,
      reason: 'Loyal subscription customer - notify to update payment method and retry',
    };
  }

  // One-time purchase with expired card → escalate
  return {
    decision: 'escalate',
    confidence: 0.6,
    reason: 'Non-recurring transaction with expired card needs outreach',
  };
}

/**
 * Evaluate generic card declined.
 */
function evaluateDeclineGeneric(
  customer: Customer,
  details: DeclineDetails
): Decision {
  // Already retried multiple times → escalate
  if (details.auto_retry_count >= 2) {
    return {
      decision: 'escalate',
      confidence: 0.7,
      reason: 'Multiple retry attempts failed - requires manual investigation',
    };
  }

  // Good customer → one more retry
  if (customer.riskScore === 'low') {
    return {
      decision: 'retry_payment',
      confidence: 0.75,
      reason: 'Low-risk customer - attempting one more retry',
    };
  }

  return {
    decision: 'escalate',
    confidence: 0.55,
    reason: 'Generic decline for non-low-risk customer - needs review',
  };
}

/**
 * Evaluate a missed installment issue.
 */
function evaluateMissedInstallment(
  issue: Issue,
  customer: Customer
): Decision {
  const details = issue.details as MissedInstallmentDetails;
  const { days_overdue } = details;

  // Recently overdue, good customer → send reminder
  if (days_overdue <= 7 && customer.riskScore !== 'high') {
    return {
      decision: 'send_reminder',
      confidence: 0.75,
      reason: 'Short overdue period for good customer - sending reminder and retrying',
    };
  }

  // Significantly overdue → collections review
  if (days_overdue > 30) {
    return {
      decision: 'escalate',
      confidence: 0.4,
      reason: 'Extended overdue period (30+ days) - requires collections review',
    };
  }

  // Middle ground (8-30 days)
  if (customer.riskScore === 'low' && days_overdue <= 14) {
    return {
      decision: 'send_reminder',
      confidence: 0.65,
      reason: 'Low-risk customer with moderate overdue - scheduling retry with notification',
    };
  }

  // Escalate for review
  return {
    decision: 'escalate',
    confidence: 0.55,
    reason: 'Moderately overdue - needs payment arrangement review',
  };
}

/**
 * Evaluate a dispute issue.
 */
function evaluateDispute(
  issue: Issue,
  transaction: Transaction
): Decision {
  const details = issue.details as DisputeDetails;
  const shipping = transaction.shippingInfo;

  switch (details.reason) {
    case 'item_not_received':
      return evaluateDisputeItemNotReceived(details, shipping);

    case 'unauthorized':
      return evaluateDisputeUnauthorized();

    case 'product_issue':
      return evaluateDisputeProductIssue(details);

    default:
      return {
        decision: 'escalate',
        confidence: 0.5,
        reason: 'Unknown dispute reason - requires manual review',
      };
  }
}

/**
 * Evaluate item not received dispute.
 */
function evaluateDisputeItemNotReceived(
  details: DisputeDetails,
  shipping: Transaction['shippingInfo']
): Decision {
  // Tracking shows delivered → contest dispute
  if (shipping?.status === 'delivered') {
    return {
      decision: 'contest_dispute',
      confidence: 0.95,
      reason: 'Carrier tracking confirms delivery - dispute denied',
    };
  }

  // Still in transit (recent purchase) → escalate to wait
  if (details.days_since_purchase < 14 && shipping?.status === 'in_transit') {
    return {
      decision: 'escalate',
      confidence: 0.4,
      reason: 'Package still in transit - verify with carrier before decision',
    };
  }

  // No tracking or lost → accept dispute
  if (!shipping || shipping.status === 'lost') {
    return {
      decision: 'accept_dispute',
      confidence: 0.85,
      reason: 'No delivery confirmation available - approving refund',
    };
  }

  // Pending shipment with recent purchase
  if (shipping.status === 'pending' && details.days_since_purchase < 7) {
    return {
      decision: 'escalate',
      confidence: 0.6,
      reason: 'Order recently placed and shipment pending - needs fulfillment check',
    };
  }

  return {
    decision: 'escalate',
    confidence: 0.5,
    reason: 'Requires manual investigation',
  };
}

/**
 * Evaluate unauthorized transaction dispute.
 */
function evaluateDisputeUnauthorized(): Decision {
  // Unauthorized transactions always need fraud review
  return {
    decision: 'escalate',
    confidence: 0.3,
    reason: 'Unauthorized transaction claim requires fraud investigation',
  };
}

/**
 * Evaluate product issue dispute.
 */
function evaluateDisputeProductIssue(details: DisputeDetails): Decision {
  // Recent purchase with product issue → likely legitimate
  if (details.days_since_purchase <= 14) {
    return {
      decision: 'accept_dispute',
      confidence: 0.75,
      reason: 'Recent product issue report - approving refund within return window',
    };
  }

  // Older purchase → needs more investigation
  return {
    decision: 'escalate',
    confidence: 0.55,
    reason: 'Product issue reported after return window - needs verification',
  };
}

/**
 * Evaluate a refund request.
 */
function evaluateRefundRequest(
  issue: Issue,
  transaction: Transaction
): Decision {
  const details = issue.details as RefundRequestDetails;
  const { days_since_purchase, reason } = details;

  // Within return window, no installments → auto-approve
  if (days_since_purchase <= 7 && !transaction.installmentPlan) {
    return {
      decision: 'approve_refund',
      confidence: 0.95,
      reason: 'Within 7-day return window - standard refund policy applies',
    };
  }

  // Within 30-day window, no installments
  if (days_since_purchase <= 30 && !transaction.installmentPlan) {
    // Defective items get easier approval
    if (reason === 'defective' || reason === 'wrong_item') {
      return {
        decision: 'approve_refund',
        confidence: 0.85,
        reason: `${reason === 'defective' ? 'Defective' : 'Wrong'} item - approving refund within 30-day window`,
      };
    }

    return {
      decision: 'approve_refund',
      confidence: 0.75,
      reason: 'Within 30-day return window - approving refund',
    };
  }

  // Active installment plan with payments made → needs finance review
  if (transaction.installmentPlan && transaction.installmentPlan.completed > 0) {
    return {
      decision: 'escalate',
      confidence: 0.55,
      reason: 'Active installment plan with payments made - requires finance review',
    };
  }

  // Installment plan with no payments yet → can cancel
  if (transaction.installmentPlan && transaction.installmentPlan.completed === 0) {
    return {
      decision: 'approve_refund',
      confidence: 0.85,
      reason: 'Installment plan with no payments - cancelling plan',
    };
  }

  // Outside return window
  if (days_since_purchase > 30) {
    // Defective still gets consideration
    if (reason === 'defective') {
      return {
        decision: 'escalate',
        confidence: 0.6,
        reason: 'Defective item reported after return window - needs quality review',
      };
    }

    return {
      decision: 'deny_refund',
      confidence: 0.8,
      reason: 'Outside 30-day return policy window',
    };
  }

  return {
    decision: 'escalate',
    confidence: 0.6,
    reason: 'Non-standard refund request - requires review',
  };
}

/**
 * Main decision engine entry point.
 * Routes to the appropriate evaluator based on issue type.
 */
export function evaluate(
  issue: Issue,
  customer: Customer,
  transaction: Transaction
): Decision {
  switch (issue.type) {
    case 'decline':
      return evaluateDecline(issue, customer, transaction);

    case 'missed_installment':
      return evaluateMissedInstallment(issue, customer);

    case 'dispute':
      return evaluateDispute(issue, transaction);

    case 'refund_request':
      return evaluateRefundRequest(issue, transaction);

    default:
      return {
        decision: 'escalate',
        confidence: 0.5,
        reason: `Unknown issue type: ${issue.type}`,
      };
  }
}

/**
 * Map decision to final resolution string.
 */
export function decisionToResolution(decision: DecisionType): string {
  switch (decision) {
    // Decline actions
    case 'retry_payment':
      return 'payment_retry_scheduled';
    case 'block_card':
      return 'card_blocked';
    // Refund request actions
    case 'approve_refund':
      return 'refund_approved';
    case 'deny_refund':
      return 'refund_denied';
    // Dispute actions
    case 'accept_dispute':
      return 'dispute_accepted';
    case 'contest_dispute':
      return 'dispute_contested';
    // Missed installment actions
    case 'send_reminder':
      return 'reminder_sent';
    case 'charge_late_fee':
      return 'late_fee_charged';
    // Common
    case 'escalate':
      return 'escalated';
    default:
      return 'resolved';
  }
}
