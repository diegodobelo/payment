import { z } from 'zod';

// Audit action values
const auditActionValues = ['create', 'update', 'delete', 'review', 'pii_access'] as const;

// Audit entity type values
const auditEntityTypeValues = ['issue', 'customer', 'transaction'] as const;

// List audit logs query schema
export const listAuditLogsQuerySchema = z.object({
  entity_type: z.enum(auditEntityTypeValues).optional(),
  entity_id: z.string().uuid().optional(),
  action: z.enum(auditActionValues).optional(),
  actor: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
