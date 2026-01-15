'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DecisionRecord, Pagination } from '@/lib/types';

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAction(action: string | null) {
  if (!action) return '-';
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getAgreementBadge(agreement: string | null) {
  if (!agreement) {
    return <Badge variant="secondary">Pending</Badge>;
  }
  switch (agreement) {
    case 'agreed':
      return <Badge className="bg-green-100 text-green-800">Agreed</Badge>;
    case 'modified':
      return <Badge className="bg-yellow-100 text-yellow-800">Modified</Badge>;
    case 'rejected':
      return <Badge className="bg-red-100 text-red-800">Rejected</Badge>;
    default:
      return <Badge variant="secondary">{agreement}</Badge>;
  }
}

interface DecisionsTableProps {
  decisions: DecisionRecord[];
  pagination: Pagination;
}

export function DecisionsTable({ decisions, pagination }: DecisionsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`/analytics?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Issue</TableHead>
            <TableHead>AI Action</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Human Action</TableHead>
            <TableHead>Agreement</TableHead>
            <TableHead>Reviewer</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decisions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No decision records found
              </TableCell>
            </TableRow>
          ) : (
            decisions.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <Link
                    href={`/issues/${record.issue_id}`}
                    className="font-mono text-sm text-blue-600 hover:underline"
                  >
                    {record.issue_id.slice(0, 8)}...
                  </Link>
                </TableCell>
                <TableCell>{formatAction(record.ai_action)}</TableCell>
                <TableCell>
                  {record.ai_confidence !== null ? `${record.ai_confidence}%` : '-'}
                </TableCell>
                <TableCell>{formatAction(record.human_action)}</TableCell>
                <TableCell>{getAgreementBadge(record.agreement)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {record.reviewed_by || '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(record.created_at)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} records
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.total_pages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
