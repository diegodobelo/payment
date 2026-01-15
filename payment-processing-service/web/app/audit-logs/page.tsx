import { Suspense } from 'react';
import { getAuditLogs } from '@/lib/api';
import { AuditLogsTable } from '@/components/audit-logs-table';
import { AuditLogsFilter } from '@/components/audit-logs-filter';
import type { AuditEntityType, AuditAction } from '@/lib/types';

interface AuditLogsPageProps {
  searchParams: Promise<{
    entity_type?: string;
    action?: string;
    page?: string;
    limit?: string;
  }>;
}

async function AuditLogsContent({ searchParams }: AuditLogsPageProps) {
  const params = await searchParams;
  const page = params.page ? parseInt(params.page, 10) : 1;
  const limit = params.limit ? parseInt(params.limit, 10) : 20;
  const entityType = params.entity_type as AuditEntityType | undefined;
  const action = params.action as AuditAction | undefined;

  const response = await getAuditLogs({
    entity_type: entityType,
    action,
    page,
    limit,
  });

  return (
    <AuditLogsTable logs={response.data} pagination={response.pagination} />
  );
}

export default function AuditLogsPage(props: AuditLogsPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-muted-foreground">
          Track all changes and access to entities in the system
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Suspense fallback={<div className="h-10" />}>
          <AuditLogsFilter />
        </Suspense>
      </div>

      <Suspense fallback={<div className="text-muted-foreground">Loading audit logs...</div>}>
        <AuditLogsContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
