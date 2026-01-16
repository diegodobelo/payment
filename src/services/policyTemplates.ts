import type { IssueType } from '../db/schema/enums.js';

/**
 * Action types allowed for each issue type.
 */
export const ACTION_TYPES_BY_ISSUE: Record<IssueType, readonly string[]> = {
  decline: ['retry_payment', 'block_card', 'escalate'],
  dispute: ['accept_dispute', 'contest_dispute', 'escalate'],
  refund_request: ['approve_refund', 'deny_refund', 'escalate'],
  missed_installment: ['send_reminder', 'charge_late_fee', 'escalate'],
} as const;

/**
 * Returns generic confidence guidelines shared across all issue types.
 */
export function getConfidenceGuidelines(): string {
  return `## Confidence Guidelines

Your confidence score determines how the issue is routed:

| Confidence | Routing | When to Use |
|------------|---------|-------------|
| 90-100 | **Auto-resolve** - Decision executed immediately | Clear-cut cases matching policy exactly, low-risk customer, no edge cases |
| 70-89 | **Human review** - Decision queued for approval | Good policy fit but some ambiguity, want human confirmation |
| 0-69 | **Escalate** - Needs human decision | Unclear situation, conflicting factors, high-risk customer, or policy doesn't clearly apply |

Be calibrated:
- Don't default to 85% for everything - vary your confidence based on the situation
- High confidence (90+) requires: clear policy match AND low-risk customer AND no complicating factors
- When in doubt, lower confidence is safer than higher`;
}

/**
 * Returns general guidelines shared across all issue types.
 */
export function getGeneralGuidelines(): string {
  return `## General Guidelines

1. **When in doubt, escalate.** A human reviewing a borderline case costs less than a wrong automated decision.

2. **High-value customers get extra care.** Even if a case could be auto-resolved, consider escalating for customers with lifetime spend > $2000.

3. **Document everything.** Every decision—automated or human—must be logged with reasoning.

4. **Speed matters, but accuracy matters more.** A fast wrong decision costs more than a slightly slower correct one.`;
}

/**
 * Returns output format section with allowed actions for the issue type.
 */
export function getOutputFormat(issueType: IssueType): string {
  const actions = ACTION_TYPES_BY_ISSUE[issueType];
  const actionUnion = actions.map((a) => `"${a}"`).join(' | ');

  return `## Output Format

Return ONLY valid JSON with no additional text:

\`\`\`json
{
  "decision": "auto_resolve" | "human_review" | "escalate",
  "action": ${actionUnion},
  "confidence": <0-100>,
  "reasoning": "<detailed explanation of why this decision was made>",
  "policyApplied": "<which specific policy rule was applied>"
}
\`\`\``;
}
