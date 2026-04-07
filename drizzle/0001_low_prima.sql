DROP INDEX "users_email_tenant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_tenant_unique" ON "users" USING btree ("email","tenant_id");