import { z } from 'zod';

// Agreement status values
const agreementValues = ['agreed', 'modified', 'rejected'] as const;

// List decisions query schema
export const listDecisionsQuerySchema = z.object({
  agreement: z.enum([...agreementValues, 'pending']).optional(),
  ai_decision: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;
