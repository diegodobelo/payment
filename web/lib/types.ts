// Issue types
export type IssueType = 'decline' | 'missed_installment' | 'dispute' | 'refund_request';

export type IssueStatus = 'pending' | 'processing' | 'awaiting_review' | 'resolved' | 'failed';

export type IssuePriority = 'low' | 'normal' | 'high' | 'critical';

// Decision types by issue type
export type DeclineDecision = 'retry_payment' | 'block_card' | 'escalate';
export type RefundDecision = 'approve_refund' | 'deny_refund' | 'escalate';
export type DisputeDecision = 'accept_dispute' | 'contest_dispute' | 'escalate';
export type InstallmentDecision = 'send_reminder' | 'charge_late_fee' | 'escalate';

export type DecisionType = DeclineDecision | RefundDecision | DisputeDecision | InstallmentDecision;

// Issue details by type
export interface DeclineDetails {
  error_code: 'insufficient_funds' | 'card_expired' | 'card_declined';
  auto_retry_count: number;
}

export interface MissedInstallmentDetails {
  installment_number: number;
  total_installments: number;
  amount_due: number;
  days_overdue: number;
}

export interface DisputeDetails {
  reason: 'item_not_received' | 'unauthorized' | 'product_issue';
  days_since_purchase: number;
}

export interface RefundRequestDetails {
  reason: 'changed_mind' | 'defective' | 'wrong_item';
  days_since_purchase: number;
  partial_amount?: number;
}

export type IssueDetails =
  | DeclineDetails
  | MissedInstallmentDetails
  | DisputeDetails
  | RefundRequestDetails;

// Processing history entry
export interface ProcessingHistoryEntry {
  from_status: string | null;
  to_status: string;
  changed_by: string;
  reason: string | null;
  timestamp: string;
}

// Automated decision
export interface AutomatedDecision {
  decision: DecisionType;
  confidence: number;
  reason: string;
}

// Human review
export interface HumanReview {
  decision: DecisionType;
  reason: string;
  reviewer_email: string;
  reviewed_at: string;
}

// Issue list item (summary for table)
export interface IssueListItem {
  id: string;
  external_id: string;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority;
  automated_decision: DecisionType | null;
  human_decision: DecisionType | null;
  final_resolution: string | null;
  created_at: string;
  updated_at: string;
}

// Full issue details
export interface Issue {
  id: string;
  external_id: string;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority;
  customer_id: string;
  transaction_id: string;
  details: IssueDetails;
  retry_count: number;
  last_retry_at: string | null;
  automated_decision: AutomatedDecision | null;
  human_review: HumanReview | null;
  final_resolution: string | null;
  resolution_reason: string | null;
  processing_history: ProcessingHistoryEntry[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

// Pagination
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

// Paginated response
export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// API request types
export interface GetIssuesParams {
  status?: IssueStatus;
  type?: IssueType;
  priority?: IssuePriority;
  customer_id?: string;
  page?: number;
  limit?: number;
  sort_by?: 'createdAt' | 'priority' | 'updatedAt';
  sort_order?: 'asc' | 'desc';
}

export interface ReviewSubmission {
  decision: DecisionType;
  reason: string;
  reviewer_email: string;
}

// Decision options by issue type (for human review - escalate is AI-only)
export const DECISION_OPTIONS: Record<IssueType, { value: DecisionType; label: string }[]> = {
  decline: [
    { value: 'retry_payment', label: 'Retry Payment' },
    { value: 'block_card', label: 'Block Card' },
  ],
  refund_request: [
    { value: 'approve_refund', label: 'Approve Refund' },
    { value: 'deny_refund', label: 'Deny Refund' },
  ],
  dispute: [
    { value: 'accept_dispute', label: 'Accept Dispute' },
    { value: 'contest_dispute', label: 'Contest Dispute' },
  ],
  missed_installment: [
    { value: 'send_reminder', label: 'Send Reminder' },
    { value: 'charge_late_fee', label: 'Charge Late Fee' },
  ],
};

// Analytics types
export interface AgreementStats {
  total: number;
  agreed: number;
  modified: number;
  rejected: number;
  pending: number;
  agreement_rate: number;
}

export interface DecisionRecord {
  id: string;
  issue_id: string;
  ai_decision: string | null;
  ai_action: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  ai_policy_applied: string | null;
  human_decision: string | null;
  human_action: string | null;
  human_reason: string | null;
  agreement: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface GetDecisionsParams {
  agreement?: 'agreed' | 'modified' | 'rejected' | 'pending';
  ai_decision?: string;
  page?: number;
  limit?: number;
}

// Audit log types
export type AuditEntityType = 'issue' | 'customer' | 'transaction';
export type AuditAction = 'create' | 'update' | 'delete' | 'review' | 'pii_access';

export interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface AuditLogEntry {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  actor: string;
  actor_ip: string | null;
  request_id: string | null;
  changes: AuditChange[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface GetAuditLogsParams {
  entity_type?: AuditEntityType;
  entity_id?: string;
  action?: AuditAction;
  actor?: string;
  page?: number;
  limit?: number;
}
