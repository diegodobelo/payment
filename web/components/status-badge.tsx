import { Badge } from '@/components/ui/badge';
import type { IssueStatus, IssuePriority } from '@/lib/types';

const STATUS_STYLES: Record<IssueStatus, string> = {
  pending: 'bg-gray-100 text-gray-800 hover:bg-gray-100',
  processing: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  awaiting_review: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  resolved: 'bg-green-100 text-green-800 hover:bg-green-100',
  failed: 'bg-red-100 text-red-800 hover:bg-red-100',
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  awaiting_review: 'Awaiting Review',
  resolved: 'Resolved',
  failed: 'Failed',
};

const PRIORITY_STYLES: Record<IssuePriority, string> = {
  low: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  normal: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  high: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  critical: 'bg-red-100 text-red-800 hover:bg-red-100',
};

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge variant="secondary" className={STATUS_STYLES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  return (
    <Badge variant="secondary" className={PRIORITY_STYLES[priority]}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}
