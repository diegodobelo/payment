import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import type { Issue, Customer, Transaction } from '../db/schema/index.js';
import type { DecisionType } from '../db/schema/enums.js';

/**
 * AI Decision result from the Claude Agent.
 */
export interface AIDecision {
  decision: 'auto_resolve' | 'human_review' | 'escalate';
  action: DecisionType;
  confidence: number;
  reasoning: string;
  policyApplied: string;
}

/**
 * Map issue type to skill file name.
 */
const SKILL_MAP: Record<string, string> = {
  decline: 'decline-policy.md',
  dispute: 'dispute-policy.md',
  refund_request: 'refund-policy.md',
  missed_installment: 'installment-policy.md',
};

/**
 * Load skill content from file.
 */
function loadSkill(issueType: string): string {
  const skillFile = SKILL_MAP[issueType];
  if (!skillFile) {
    throw new Error(`No skill defined for issue type: ${issueType}`);
  }

  const skillPath = join(process.cwd(), '.claude', 'skills', skillFile);
  try {
    return readFileSync(skillPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to load skill file: ${skillPath}`);
  }
}

/**
 * Build context object for the AI agent.
 * Excludes PII - only includes data needed for decision making.
 */
function buildContext(
  issue: Issue,
  customer: Customer,
  transaction: Transaction
): string {
  const context = {
    issue: {
      id: issue.id,
      type: issue.type,
      priority: issue.priority,
      details: issue.details,
      retryCount: issue.retryCount,
      createdAt: issue.createdAt,
    },
    customer: {
      id: customer.id,
      riskScore: customer.riskScore,
      lifetimeTransactions: customer.lifetimeTransactions,
      lifetimeSpend: customer.lifetimeSpend,
      successfulPayments: customer.successfulPayments,
      failedPayments: customer.failedPayments,
      disputesFiled: customer.disputesFiled,
      disputesWon: customer.disputesWon,
      currentInstallmentPlans: customer.currentInstallmentPlans,
      accountCreated: customer.accountCreated,
    },
    transaction: {
      id: transaction.id,
      amount: transaction.amount,
      status: transaction.status,
      merchant: transaction.merchant,
      isRecurring: transaction.isRecurring,
      failureReason: transaction.failureReason,
      installmentPlan: transaction.installmentPlan,
      shippingInfo: transaction.shippingInfo,
      createdAt: transaction.createdAt,
    },
  };

  return JSON.stringify(context, null, 2);
}

/**
 * Parse and validate AI response.
 */
function parseAIResponse(response: string): AIDecision {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in AI response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate required fields
  if (!parsed.decision || !parsed.action || parsed.confidence === undefined) {
    throw new Error('Missing required fields in AI response');
  }

  // Validate decision values
  const validDecisions = ['auto_resolve', 'human_review', 'escalate'];
  if (!validDecisions.includes(parsed.decision)) {
    throw new Error(`Invalid decision value: ${parsed.decision}`);
  }

  // Validate action values
  const validActions = ['approve_retry', 'approve_refund', 'reject', 'escalate'];
  if (!validActions.includes(parsed.action)) {
    throw new Error(`Invalid action value: ${parsed.action}`);
  }

  // Validate confidence range
  if (parsed.confidence < 0 || parsed.confidence > 100) {
    throw new Error(`Confidence must be 0-100, got: ${parsed.confidence}`);
  }

  return {
    decision: parsed.decision,
    action: parsed.action as DecisionType,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning || 'No reasoning provided',
    policyApplied: parsed.policyApplied || 'Unknown',
  };
}

/**
 * Map AI decision to routing status.
 */
export function mapDecisionToStatus(
  aiDecision: AIDecision
): 'resolved' | 'awaiting_review' | 'failed' {
  const { confidence } = aiDecision;
  const { autoResolveThreshold, humanReviewThreshold } = config.decisionEngine;

  if (confidence >= autoResolveThreshold) {
    return 'resolved';
  } else if (confidence >= humanReviewThreshold) {
    return 'awaiting_review';
  } else {
    return 'awaiting_review'; // Low confidence also goes to human review
  }
}

/**
 * Evaluate an issue using the AI decision engine.
 */
export async function evaluateWithAI(
  issue: Issue,
  customer: Customer,
  transaction: Transaction
): Promise<AIDecision> {
  const log = logger.child({ issueId: issue.id, issueType: issue.type });

  // Check for API key
  if (!config.decisionEngine.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for AI decision engine');
  }

  log.info('Starting AI evaluation');

  // Load the appropriate skill
  const skillContent = loadSkill(issue.type);

  // Build context
  const context = buildContext(issue, customer, transaction);

  // Build prompt
  const prompt = `${skillContent}

---

## Issue Context

${context}

---

Analyze this issue and provide your decision in the specified JSON format.`;

  // Capture stderr output for better error messages
  let stderrOutput = '';

  try {
    let result = '';

    // Call Claude Agent SDK with stderr callback
    for await (const message of query({
      prompt,
      options: {
        allowedTools: [], // Read-only, no tools needed for policy decisions
        maxTurns: 1, // Single turn for decision
        stderr: (data: string) => {
          stderrOutput += data;
        },
      },
    })) {
      // Check for result errors (max_turns, max_budget, etc.)
      if (
        'type' in message &&
        message.type === 'result' &&
        'subtype' in message &&
        typeof message.subtype === 'string' &&
        message.subtype.startsWith('error_')
      ) {
        const errors =
          'errors' in message && Array.isArray(message.errors)
            ? message.errors.join(', ')
            : 'Unknown error';
        throw new Error(`AI decision failed: ${message.subtype} - ${errors}`);
      }

      // Check for assistant message errors (auth, billing, rate limit)
      if ('type' in message && message.type === 'assistant' && 'error' in message && message.error) {
        throw new Error(`AI API error: ${message.error}`);
      }

      // Collect successful result
      if ('result' in message && message.result) {
        result = message.result;
      }
    }

    if (!result) {
      throw new Error('No result from AI agent');
    }

    // Parse and validate response
    const decision = parseAIResponse(result);

    log.info(
      {
        decision: decision.decision,
        action: decision.action,
        confidence: decision.confidence,
      },
      'AI evaluation completed'
    );

    return decision;
  } catch (error) {
    log.error(
      {
        err: error,
        stderr: stderrOutput || undefined,
      },
      'AI evaluation failed'
    );
    throw error;
  }
}

export const aiDecisionEngine = {
  evaluateWithAI,
  mapDecisionToStatus,
};
