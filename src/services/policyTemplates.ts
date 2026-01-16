import type { IssueType } from '../db/schema/enums.js';

/**
 * Action types allowed for each issue type.
 */
export const ACTION_TYPES_BY_ISSUE: Record<IssueType, readonly string[]> = {
  decline: ['retry_payment', 'block_card'],
  dispute: ['accept_dispute', 'contest_dispute'],
  refund_request: ['approve_refund', 'deny_refund'],
  missed_installment: ['send_reminder', 'charge_late_fee'],
} as const;

/**
 * Returns generic confidence guidelines shared across all issue types.
 */
export function getConfidenceGuidelines(): string {
  return `## Confidence Guidelines

Always check the "actions" in the output format to determine the confidence level.
The "actions" are related to the issue type.

Your confidence score determines the decision in the output:

| Confidence | When to Use |
|------------|-------------|
| 90-100 | Clear-cut cases matching policy exactly, low-risk customer, no edge cases |
| 70-89 | Good policy fit but some ambiguity, want human confirmation |
| 0-69 | Unclear situation, conflicting factors, high-risk customer, or policy doesn't clearly apply |

Be calibrated:
- Vary your confidence based on the situation and the issue context
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
  "action": ${actionUnion},
  "confidence": <0-100>,
  "reasoning": "<detailed explanation of why this decision was made>",
  "policyApplied": "<which specific policy rule was applied>"
}
\`\`\``;
}
