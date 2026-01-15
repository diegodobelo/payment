'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { submitReview, ApiError } from '@/lib/api';
import { DECISION_OPTIONS, type IssueType, type DecisionType } from '@/lib/types';

interface ReviewFormProps {
  issueId: string;
  issueType: IssueType;
}

export function ReviewForm({ issueId, issueType }: ReviewFormProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionType | ''>('');
  const [reason, setReason] = useState('');
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const decisionOptions = DECISION_OPTIONS[issueType] || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!decision) {
      setError('Please select a decision');
      return;
    }

    if (reason.length < 1 || reason.length > 1000) {
      setError('Reason must be between 1 and 1000 characters');
      return;
    }

    if (!reviewerEmail || !reviewerEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);

    try {
      await submitReview(issueId, {
        decision: decision as DecisionType,
        reason,
        reviewer_email: reviewerEmail,
      });
      setSuccess(true);
      // Refresh the page to show updated status
      setTimeout(() => {
        router.refresh();
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to submit review. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6">
          <p className="text-green-800 font-medium">
            Review submitted successfully! Refreshing...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit Review</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="decision">Decision</Label>
            <Select
              value={decision}
              onValueChange={(value) => setDecision(value as DecisionType)}
            >
              <SelectTrigger id="decision">
                <SelectValue placeholder="Select a decision" />
              </SelectTrigger>
              <SelectContent>
                {decisionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              placeholder="Explain your decision..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {reason.length}/1000 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Reviewer Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={reviewerEmail}
              onChange={(e) => setReviewerEmail(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
