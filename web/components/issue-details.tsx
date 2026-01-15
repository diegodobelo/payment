import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, PriorityBadge } from '@/components/status-badge';
import type { Issue } from '@/lib/types';

const TYPE_LABELS: Record<string, string> = {
  decline: 'Decline',
  missed_installment: 'Missed Installment',
  dispute: 'Dispute',
  refund_request: 'Refund Request',
};

function formatDateTime(dateString: string | null) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

interface IssueDetailsProps {
  issue: Issue;
}

export function IssueDetails({ issue }: IssueDetailsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Issue Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">External ID</p>
              <p className="font-mono">{issue.external_id}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Type</p>
              <p>{TYPE_LABELS[issue.type] || issue.type}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <StatusBadge status={issue.status} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Priority</p>
              <PriorityBadge priority={issue.priority} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Customer ID</p>
              <p className="font-mono text-sm">{issue.customer_id}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Transaction ID</p>
              <p className="font-mono text-sm">{issue.transaction_id}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issue Details */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-sm bg-muted p-3 rounded-md overflow-auto">
            {JSON.stringify(issue.details, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Automated Decision */}
      {issue.automated_decision && (
        <Card>
          <CardHeader>
            <CardTitle>Automated Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Decision</p>
                <p className="font-medium">
                  {issue.automated_decision.decision
                    .split('_')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ')}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Confidence</p>
                <p className="font-medium">
                  {formatConfidence(issue.automated_decision.confidence)}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Reasoning</p>
              <p className="text-sm mt-1">{issue.automated_decision.reason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Human Review */}
      {issue.human_review && (
        <Card>
          <CardHeader>
            <CardTitle>Human Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Decision</p>
                <p className="font-medium">
                  {issue.human_review.decision
                    .split('_')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ')}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Reviewer</p>
                <p className="text-sm">{issue.human_review.reviewer_email}</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Reason</p>
              <p className="text-sm mt-1">{issue.human_review.reason}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Reviewed At</p>
              <p className="text-sm">{formatDateTime(issue.human_review.reviewed_at)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resolution */}
      {issue.final_resolution && (
        <Card>
          <CardHeader>
            <CardTitle>Resolution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Final Resolution</p>
              <p className="font-medium">
                {issue.final_resolution
                  .split('_')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ')}
              </p>
            </div>
            {issue.resolution_reason && (
              <div>
                <p className="text-sm text-muted-foreground">Reason</p>
                <p className="text-sm mt-1">{issue.resolution_reason}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Resolved At</p>
              <p className="text-sm">{formatDateTime(issue.resolved_at)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timestamps */}
      <Card>
        <CardHeader>
          <CardTitle>Timestamps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Created</span>
            <span className="text-sm">{formatDateTime(issue.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Updated</span>
            <span className="text-sm">{formatDateTime(issue.updated_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Retry Count</span>
            <span className="text-sm">{issue.retry_count}</span>
          </div>
          {issue.last_retry_at && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Last Retry</span>
              <span className="text-sm">{formatDateTime(issue.last_retry_at)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
