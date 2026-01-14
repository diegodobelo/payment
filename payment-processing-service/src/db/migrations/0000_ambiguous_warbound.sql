CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'review', 'pii_access');--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type" AS ENUM('issue', 'customer', 'transaction');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('approve_retry', 'approve_refund', 'reject', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('pending', 'processing', 'awaiting_review', 'resolved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('decline', 'missed_installment', 'dispute', 'refund_request');--> statement-breakpoint
CREATE TYPE "public"."priority_level" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."risk_score" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('failed', 'completed', 'active_installment', 'refunded');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(50) NOT NULL,
	"email_encrypted" text NOT NULL,
	"name_encrypted" text NOT NULL,
	"account_created" date NOT NULL,
	"lifetime_transactions" integer DEFAULT 0 NOT NULL,
	"lifetime_spend" numeric(10, 2) DEFAULT '0' NOT NULL,
	"successful_payments" integer DEFAULT 0 NOT NULL,
	"failed_payments" integer DEFAULT 0 NOT NULL,
	"disputes_filed" integer DEFAULT 0 NOT NULL,
	"disputes_won" integer DEFAULT 0 NOT NULL,
	"current_installment_plans" integer DEFAULT 0 NOT NULL,
	"risk_score" "risk_score" DEFAULT 'low' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(50) NOT NULL,
	"customer_id" uuid NOT NULL,
	"merchant" varchar(255) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" "transaction_status" NOT NULL,
	"payment_method_encrypted" text NOT NULL,
	"failure_reason" varchar(100),
	"installment_plan" jsonb,
	"shipping_info" jsonb,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(50) NOT NULL,
	"type" "issue_type" NOT NULL,
	"status" "issue_status" DEFAULT 'pending' NOT NULL,
	"priority" "priority_level" DEFAULT 'normal' NOT NULL,
	"customer_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"details" jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp with time zone,
	"automated_decision" "decision_type",
	"automated_decision_confidence" numeric(3, 2),
	"automated_decision_reason" text,
	"human_decision" "decision_type",
	"human_decision_reason" text,
	"human_reviewer_email" varchar(255),
	"human_reviewed_at" timestamp with time zone,
	"final_resolution" varchar(50),
	"resolution_reason" text,
	"idempotency_key" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "issues_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "issues_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"from_status" varchar(50),
	"to_status" varchar(50) NOT NULL,
	"changed_by" varchar(255) NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "audit_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor" varchar(255) NOT NULL,
	"actor_ip" varchar(45),
	"request_id" varchar(100),
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customers_external" ON "customers" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_customers_risk" ON "customers" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX "idx_transactions_external" ON "transactions" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_customer" ON "transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_status" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_issues_status" ON "issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_issues_type" ON "issues" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_issues_customer" ON "issues" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_issues_transaction" ON "issues" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_issues_created" ON "issues" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_issues_priority_created" ON "issues" USING btree ("priority","created_at");--> statement-breakpoint
CREATE INDEX "idx_issues_idempotency" ON "issues" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_history_issue" ON "status_history" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_request" ON "audit_logs" USING btree ("request_id");