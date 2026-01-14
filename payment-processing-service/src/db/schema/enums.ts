import { pgEnum } from 'drizzle-orm/pg-core';

// Issue type enum
export const issueTypeEnum = pgEnum('issue_type', [
  'decline',
  'missed_installment',
  'dispute',
  'refund_request',
]);

// Issue status enum
export const issueStatusEnum = pgEnum('issue_status', [
  'pending',
  'processing',
  'awaiting_review',
  'resolved',
  'failed',
]);

// Priority level enum
export const priorityLevelEnum = pgEnum('priority_level', [
  'low',
  'normal',
  'high',
  'critical',
]);

// Decision type enum
export const decisionTypeEnum = pgEnum('decision_type', [
  'approve_retry',
  'approve_refund',
  'reject',
  'escalate',
]);

// Risk score enum
export const riskScoreEnum = pgEnum('risk_score', ['low', 'medium', 'high']);

// Transaction status enum
export const transactionStatusEnum = pgEnum('transaction_status', [
  'failed',
  'completed',
  'active_installment',
  'refunded',
]);

// Audit action enum
export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
  'review',
  'pii_access',
]);

// Audit entity type enum
export const auditEntityTypeEnum = pgEnum('audit_entity_type', [
  'issue',
  'customer',
  'transaction',
]);

// TypeScript types derived from enums
export type IssueType = (typeof issueTypeEnum.enumValues)[number];
export type IssueStatus = (typeof issueStatusEnum.enumValues)[number];
export type PriorityLevel = (typeof priorityLevelEnum.enumValues)[number];
export type DecisionType = (typeof decisionTypeEnum.enumValues)[number];
export type RiskScore = (typeof riskScoreEnum.enumValues)[number];
export type TransactionStatus = (typeof transactionStatusEnum.enumValues)[number];
export type AuditAction = (typeof auditActionEnum.enumValues)[number];
export type AuditEntityType = (typeof auditEntityTypeEnum.enumValues)[number];
