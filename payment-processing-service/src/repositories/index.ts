export { auditLogRepository, createAuditLog, logPiiAccess } from './auditLogRepository.js';
export type { CreateAuditLogParams } from './auditLogRepository.js';

export {
  customerRepository,
  findById as findCustomerById,
  findByExternalId as findCustomerByExternalId,
} from './customerRepository.js';
export type { DecryptedCustomer, AuditContext } from './customerRepository.js';

export {
  transactionRepository,
  findById as findTransactionById,
  findByExternalId as findTransactionByExternalId,
} from './transactionRepository.js';
export type { DecryptedTransaction } from './transactionRepository.js';

export { issueRepository } from './issueRepository.js';
export type {
  CreateIssueParams,
  UpdateIssueParams,
  IssueFilters,
  PaginationOptions,
  PaginatedResult,
} from './issueRepository.js';

export { statusHistoryRepository } from './statusHistoryRepository.js';
export type { CreateStatusHistoryParams } from './statusHistoryRepository.js';
