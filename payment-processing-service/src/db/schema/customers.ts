import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  integer,
  decimal,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { riskScoreEnum } from './enums';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalId: varchar('external_id', { length: 50 }).notNull().unique(),

    // PII - encrypted at application level
    emailEncrypted: text('email_encrypted').notNull(),
    nameEncrypted: text('name_encrypted').notNull(),

    // Account info
    accountCreated: date('account_created').notNull(),

    // Transaction history
    lifetimeTransactions: integer('lifetime_transactions').notNull().default(0),
    lifetimeSpend: decimal('lifetime_spend', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    successfulPayments: integer('successful_payments').notNull().default(0),
    failedPayments: integer('failed_payments').notNull().default(0),

    // Dispute history
    disputesFiled: integer('disputes_filed').notNull().default(0),
    disputesWon: integer('disputes_won').notNull().default(0),

    // Current state
    currentInstallmentPlans: integer('current_installment_plans')
      .notNull()
      .default(0),
    riskScore: riskScoreEnum('risk_score').notNull().default('low'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_customers_external').on(table.externalId),
    index('idx_customers_risk').on(table.riskScore),
  ]
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
