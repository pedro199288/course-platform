ALTER TABLE "lessons" ADD COLUMN "available_after_days" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "available_from_date" timestamp;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "available_after_days" integer;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "available_from_date" timestamp;