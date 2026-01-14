CREATE TABLE "decision_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"ai_decision" varchar(50),
	"ai_action" varchar(50),
	"ai_confidence" numeric(5, 2),
	"ai_reasoning" text,
	"ai_policy_applied" varchar(255),
	"human_decision" varchar(50),
	"human_action" varchar(50),
	"human_reason" text,
	"agreement" varchar(50),
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_analytics" ADD CONSTRAINT "decision_analytics_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analytics_issue" ON "decision_analytics" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_agreement" ON "decision_analytics" USING btree ("agreement");--> statement-breakpoint
CREATE INDEX "idx_analytics_reviewed_at" ON "decision_analytics" USING btree ("reviewed_at");