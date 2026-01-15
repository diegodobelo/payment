'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AGREEMENT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'agreed', label: 'Agreed' },
  { value: 'modified', label: 'Modified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'pending', label: 'Pending' },
];

export function DecisionsFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentAgreement = searchParams.get('agreement') || 'all';

  const handleAgreementChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete('agreement');
    } else {
      params.set('agreement', value);
    }
    params.delete('page'); // Reset to first page when filtering
    router.push(`/analytics?${params.toString()}`);
  };

  return (
    <div className="flex gap-4">
      <Select value={currentAgreement} onValueChange={handleAgreementChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Agreement" />
        </SelectTrigger>
        <SelectContent>
          {AGREEMENT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
