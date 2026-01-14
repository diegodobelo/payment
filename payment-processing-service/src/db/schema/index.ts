// Export all enums
export * from './enums';

// Export all tables
export * from './customers';
export * from './transactions';
export * from './issues';
export * from './statusHistory';
export * from './auditLogs';

// Re-export tables for convenience
import { customers } from './customers';
import { transactions } from './transactions';
import { issues } from './issues';
import { statusHistory } from './statusHistory';
import { auditLogs } from './auditLogs';

export const schema = {
  customers,
  transactions,
  issues,
  statusHistory,
  auditLogs,
};
