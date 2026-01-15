import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIssue, ApiError } from '@/lib/api';
import { IssueDetails } from '@/components/issue-details';
import { ProcessingHistory } from '@/components/processing-history';
import { ReviewForm } from '@/components/review-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function IssueDetailPage({ params }: PageProps) {
  const { id } = await params;

  let issue;
  try {
    issue = await getIssue(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/">← Back to Issues</Link>
        </Button>
        <h1 className="text-2xl font-bold">{issue.external_id}</h1>
      </div>

      <IssueDetails issue={issue} />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Processing History */}
        <Card>
          <CardHeader>
            <CardTitle>Processing History</CardTitle>
          </CardHeader>
          <CardContent>
            <ProcessingHistory history={issue.processing_history} />
          </CardContent>
        </Card>

        {/* Review Form - only show if awaiting review */}
        {issue.status === 'awaiting_review' && (
          <ReviewForm issueId={issue.id} issueType={issue.type} />
        )}
      </div>
    </div>
  );
}
