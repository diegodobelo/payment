import type { ProcessingHistoryEntry } from '@/lib/types';

function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatStatus(status: string | null) {
  if (!status) return 'Created';
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface ProcessingHistoryProps {
  history: ProcessingHistoryEntry[];
}

export function ProcessingHistory({ history }: ProcessingHistoryProps) {
  if (history.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No processing history available.</p>
    );
  }

  return (
    <div className="space-y-4">
      {history.map((entry, index) => (
        <div key={index} className="relative pl-6 pb-4 last:pb-0">
          {/* Timeline line */}
          {index < history.length - 1 && (
            <div className="absolute left-[7px] top-3 h-full w-0.5 bg-border" />
          )}

          {/* Timeline dot */}
          <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-primary bg-background" />

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">
                {entry.from_status ? (
                  <>
                    {formatStatus(entry.from_status)} → {formatStatus(entry.to_status)}
                  </>
                ) : (
                  formatStatus(entry.to_status)
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatDateTime(entry.timestamp)}</span>
              <span>•</span>
              <span>{entry.changed_by}</span>
            </div>

            {entry.reason && (
              <p className="text-sm text-muted-foreground mt-1">{entry.reason}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
