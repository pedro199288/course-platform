CREATE TABLE "bulk_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulk_emails" ADD CONSTRAINT "bulk_emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_emails" ADD CONSTRAINT "bulk_emails_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_emails_tenant_id_idx" ON "bulk_emails" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "bulk_emails_course_id_idx" ON "bulk_emails" USING btree ("course_id");
