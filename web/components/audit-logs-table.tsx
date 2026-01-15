'use client';

import { useState } from 'react';
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
import type { AuditLogEntry, Pagination } from '@/lib/types';

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActionBadge(action: string) {
  switch (action) {
    case 'create':
      return <Badge className="bg-green-100 text-green-800">Create</Badge>;
    case 'update':
      return <Badge className="bg-blue-100 text-blue-800">Update</Badge>;
    case 'delete':
      return <Badge className="bg-red-100 text-red-800">Delete</Badge>;
    case 'review':
      return <Badge className="bg-purple-100 text-purple-800">Review</Badge>;
    case 'pii_access':
      return <Badge className="bg-yellow-100 text-yellow-800">PII Access</Badge>;
    default:
      return <Badge variant="secondary">{action}</Badge>;
  }
}

function ChangesDisplay({ changes }: { changes: AuditLogEntry['changes'] }) {
  const [expanded, setExpanded] = useState(false);

  if (!changes || changes.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (!expanded) {
    return (
      <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => setExpanded(true)}>
        {changes.length} change{changes.length !== 1 ? 's' : ''}
      </Button>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => setExpanded(false)}>
        Hide
      </Button>
      <div className="text-xs space-y-1 max-w-xs">
        {changes.map((change, idx) => (
          <div key={idx} className="bg-muted p-1 rounded">
            <span className="font-medium">{change.field}:</span>{' '}
            <span className="text-muted-foreground">
              {JSON.stringify(change.oldValue)} → {JSON.stringify(change.newValue)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AuditLogsTableProps {
  logs: AuditLogEntry[];
  pagination: Pagination;
}

export function AuditLogsTable({ logs, pagination }: AuditLogsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`/audit-logs?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entity</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Changes</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No audit logs found
              </TableCell>
            </TableRow>
          ) : (
            logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground capitalize">
                      {log.entity_type}
                    </span>
                    {log.entity_type === 'issue' ? (
                      <Link
                        href={`/issues/${log.entity_id}`}
                        className="font-mono text-sm text-blue-600 hover:underline"
                      >
                        {log.entity_id.slice(0, 8)}...
                      </Link>
                    ) : (
                      <span className="font-mono text-sm">{log.entity_id.slice(0, 8)}...</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{getActionBadge(log.action)}</TableCell>
                <TableCell className="text-sm">{log.actor}</TableCell>
                <TableCell>
                  <ChangesDisplay changes={log.changes} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(log.created_at)}
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
            {pagination.total} logs
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
