ALTER TABLE "tenants" ADD COLUMN "custom_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_custom_domain_idx" ON "tenants" USING btree ("custom_domain") WHERE "custom_domain" IS NOT NULL;
