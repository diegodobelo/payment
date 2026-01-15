// Export all enums
export * from './enums';

// Export all tables
export * from './customers';
export * from './transactions';
export * from './issues';
export * from './issuesArchive';
export * from './statusHistory';
export * from './auditLogs';
export * from './decisionAnalytics';

// Re-export tables for convenience
import { customers } from './customers';
import { transactions } from './transactions';
import { issues } from './issues';
import { issuesArchive } from './issuesArchive';
import { statusHistory } from './statusHistory';
import { auditLogs } from './auditLogs';
import { decisionAnalytics } from './decisionAnalytics';

export const schema = {
  customers,
  transactions,
  issues,
  issuesArchive,
  statusHistory,
  auditLogs,
  decisionAnalytics,
};
