-- Create tenant_role enum for user_tenants membership roles
CREATE TYPE "public"."tenant_role" AS ENUM('tenant_owner', 'tenant_admin', 'student');
--> statement-breakpoint
-- Add "user" value to existing user_role enum
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'user';
--> statement-breakpoint
-- Create user_tenants junction table
CREATE TABLE "user_tenants" (
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "tenant_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_tenants_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Make users.tenant_id nullable (was NOT NULL)
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;
--> statement-breakpoint
-- Change default role from 'student' to 'user'
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user';
--> statement-breakpoint
-- Drop old composite unique index (email, tenant_id)
DROP INDEX IF EXISTS "users_email_tenant_unique";
--> statement-breakpoint
-- Drop old tenant_id index (no longer needed after tenantId is removed)
DROP INDEX IF EXISTS "users_tenant_id_idx";
--> statement-breakpoint
-- Add global unique index on email
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");
