import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { transactionStatusEnum } from './enums';
import { customers } from './customers';

// Type for installment plan JSONB
export interface InstallmentPlan {
  total: number;
  completed: number;
  amountPer: number;
  nextDue: string | null;
}

// Type for shipping info JSONB
export interface ShippingInfo {
  carrier?: string;
  trackingNumber?: string;
  status?: 'pending' | 'in_transit' | 'delivered' | 'lost';
  estimatedDelivery?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalId: varchar('external_id', { length: 50 }).notNull().unique(),

    // Customer relationship
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),

    // Transaction details
    merchant: varchar('merchant', { length: 255 }).notNull(),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    status: transactionStatusEnum('status').notNull(),

    // Payment method - encrypted at application level
    paymentMethodEncrypted: text('payment_method_encrypted').notNull(),

    // Failure info
    failureReason: varchar('failure_reason', { length: 100 }),

    // Installment details
    installmentPlan: jsonb('installment_plan').$type<InstallmentPlan>(),

    // Shipping info (nullable for digital products)
    shippingInfo: jsonb('shipping_info').$type<ShippingInfo>(),

    // Recurring subscription flag
    isRecurring: boolean('is_recurring').notNull().default(false),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_transactions_external').on(table.externalId),
    index('idx_transactions_customer').on(table.customerId),
    index('idx_transactions_status').on(table.status),
  ]
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
