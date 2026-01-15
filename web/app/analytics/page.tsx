import { Suspense } from 'react';
import { getAgreementStats, getDecisionRecords } from '@/lib/api';
import { AnalyticsStats } from '@/components/analytics-stats';
import { DecisionsTable } from '@/components/decisions-table';
import { DecisionsFilter } from '@/components/decisions-filter';

interface AnalyticsPageProps {
  searchParams: Promise<{
    agreement?: string;
    page?: string;
    limit?: string;
  }>;
}

async function AnalyticsContent({ searchParams }: AnalyticsPageProps) {
  const params = await searchParams;
  const page = params.page ? parseInt(params.page, 10) : 1;
  const limit = params.limit ? parseInt(params.limit, 10) : 20;
  const agreement = params.agreement as 'agreed' | 'modified' | 'rejected' | 'pending' | undefined;

  const [stats, decisionsResponse] = await Promise.all([
    getAgreementStats(),
    getDecisionRecords({ agreement, page, limit }),
  ]);

  return (
    <div className="space-y-6">
      <AnalyticsStats stats={stats} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Decision Records</h2>
          <DecisionsFilter />
        </div>
        <DecisionsTable
          decisions={decisionsResponse.data}
          pagination={decisionsResponse.pagination}
        />
      </div>
    </div>
  );
}

export default function AnalyticsPage(props: AnalyticsPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground">
          AI decision statistics and human review agreement tracking
        </p>
      </div>

      <Suspense fallback={<div className="text-muted-foreground">Loading analytics...</div>}>
        <AnalyticsContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
