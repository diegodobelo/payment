import { Suspense } from 'react';
import { getIssues } from '@/lib/api';
import { IssuesTable } from '@/components/issues-table';
import { IssuesFilter } from '@/components/issues-filter';
import type { IssueStatus, IssueType, GetIssuesParams } from '@/lib/types';

interface PageProps {
  searchParams: Promise<{
    status?: string;
    type?: string;
    page?: string;
    limit?: string;
  }>;
}

async function IssuesList({ searchParams }: { searchParams: GetIssuesParams }) {
  const response = await getIssues(searchParams);
  return <IssuesTable issues={response.data} pagination={response.pagination} />;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;

  const apiParams: GetIssuesParams = {
    status: params.status as IssueStatus | undefined,
    type: params.type as IssueType | undefined,
    page: params.page ? parseInt(params.page, 10) : 1,
    limit: params.limit ? parseInt(params.limit, 10) : 20,
    sort_by: 'createdAt',
    sort_order: 'desc',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Issues</h1>
        <Suspense fallback={null}>
          <IssuesFilter />
        </Suspense>
      </div>

      <Suspense
        fallback={
          <div className="text-center py-8 text-muted-foreground">
            Loading issues...
          </div>
        }
      >
        <IssuesList searchParams={apiParams} />
      </Suspense>
    </div>
  );
}
