import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import type { Issue, Customer, Transaction } from '../db/schema/index.js';
import type { DecisionType } from '../db/schema/enums.js';
import {
  evaluate as evaluateWithRules,
  decisionToResolution,
  type Decision as RulesDecision,
} from './decisionEngine.js';
import { evaluateWithAI, type AIDecision } from './aiDecisionEngine.js';

/**
 * Unified decision result that works with both engines.
 */
export interface UnifiedDecision {
  decision: DecisionType;
  confidence: number;
  reason: string;
  source: 'rules' | 'ai';
  // Additional AI-specific fields
  aiRouting?: 'auto_resolve' | 'human_review' | 'escalate';
  policyApplied?: string;
}

/**
 * Convert rules engine decision to unified format.
 */
function rulesDecisionToUnified(decision: RulesDecision): UnifiedDecision {
  return {
    decision: decision.decision,
    confidence: decision.confidence,
    reason: decision.reason,
    source: 'rules',
  };
}

/**
 * Convert AI engine decision to unified format.
 */
function aiDecisionToUnified(aiDecision: AIDecision): UnifiedDecision {
  return {
    decision: aiDecision.action,
    confidence: aiDecision.confidence / 100, // Convert 0-100 to 0-1 for consistency
    reason: aiDecision.reasoning,
    source: 'ai',
    aiRouting: aiDecision.decision,
    policyApplied: aiDecision.policyApplied,
  };
}

/**
 * Evaluate an issue using the configured decision engine.
 * Routes to either rules-based or AI-based engine based on config.
 */
export async function evaluate(
  issue: Issue,
  customer: Customer,
  transaction: Transaction
): Promise<UnifiedDecision> {
  const mode = config.decisionEngine.mode;
  const log = logger.child({ issueId: issue.id, engineMode: mode });

  log.info('Evaluating issue with decision engine');

  if (mode === 'ai') {
    try {
      const aiDecision = await evaluateWithAI(issue, customer, transaction);
      return aiDecisionToUnified(aiDecision);
    } catch (error) {
      log.error({ err: error }, 'AI decision engine failed, falling back to rules');
      // Fallback to rules on AI failure
      const rulesDecision = evaluateWithRules(issue, customer, transaction);
      return rulesDecisionToUnified(rulesDecision);
    }
  }

  // Default: rules engine
  const rulesDecision = evaluateWithRules(issue, customer, transaction);
  return rulesDecisionToUnified(rulesDecision);
}

/**
 * Determine if decision should auto-resolve based on engine type.
 */
export function shouldAutoResolve(decision: UnifiedDecision): boolean {
  if (decision.source === 'ai') {
    // For AI decisions, use the routing field
    return decision.aiRouting === 'auto_resolve';
  }

  // For rules decisions, use the original logic
  // Never auto-resolve escalations
  if (decision.decision === 'escalate') {
    return false;
  }

  return decision.confidence >= config.confidenceThreshold;
}

/**
 * Get the final resolution string from a decision.
 */
export function getResolution(decision: UnifiedDecision): string {
  return decisionToResolution(decision.decision);
}

export const decisionEngineRouter = {
  evaluate,
  shouldAutoResolve,
  getResolution,
};
