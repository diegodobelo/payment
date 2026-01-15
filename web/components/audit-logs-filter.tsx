'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ENTITY_TYPE_OPTIONS = [
  { value: 'all', label: 'All Entities' },
  { value: 'issue', label: 'Issue' },
  { value: 'customer', label: 'Customer' },
  { value: 'transaction', label: 'Transaction' },
];

const ACTION_OPTIONS = [
  { value: 'all', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'review', label: 'Review' },
  { value: 'pii_access', label: 'PII Access' },
];

export function AuditLogsFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentEntityType = searchParams.get('entity_type') || 'all';
  const currentAction = searchParams.get('action') || 'all';

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page'); // Reset to first page when filtering
    router.push(`/audit-logs?${params.toString()}`);
  };

  return (
    <div className="flex gap-4">
      <Select
        value={currentEntityType}
        onValueChange={(value) => handleFilterChange('entity_type', value)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Entity Type" />
        </SelectTrigger>
        <SelectContent>
          {ENTITY_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentAction}
        onValueChange={(value) => handleFilterChange('action', value)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Action" />
        </SelectTrigger>
        <SelectContent>
          {ACTION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
