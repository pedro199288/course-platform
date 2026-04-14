import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import type { RichTextDoc } from "#/lib/rich-text/types.ts";

async function requireAdmin() {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Error("Unauthorized");

  const user = session.user as { id: string; role: string; tenantId: string };
  if (!["platform_admin", "tenant_owner", "tenant_admin"].includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}

/**
 * Get tenant settings (tracking IDs + about instructor).
 */
export const getTenantSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, user.tenantId),
    columns: {
      gaTrackingId: true,
      fbPixelId: true,
      aboutInstructor: true,
    },
  });
  if (!tenant) throw new Error("Tenant not found");
  return tenant;
});

/**
 * Update tracking IDs (GA + Facebook Pixel).
 */
export const updateTrackingIdsFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { gaTrackingId: string | null; fbPixelId: string | null }) => d,
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    // Basic validation: GA tracking IDs look like G-XXXXXXX or UA-XXXXX-X
    if (data.gaTrackingId && !/^(G-[A-Z0-9]+|UA-\d+-\d+)$/.test(data.gaTrackingId)) {
      throw new Error("Invalid Google Analytics tracking ID format");
    }

    // FB Pixel IDs are numeric
    if (data.fbPixelId && !/^\d+$/.test(data.fbPixelId)) {
      throw new Error("Invalid Facebook Pixel ID format");
    }

    await db
      .update(tenants)
      .set({
        gaTrackingId: data.gaTrackingId || null,
        fbPixelId: data.fbPixelId || null,
      })
      .where(eq(tenants.id, user.tenantId));

    return { ok: true };
  });

/**
 * Update the "About Instructor" rich text content.
 */
export const updateAboutInstructorFn = createServerFn({ method: "POST" })
  .inputValidator((d: { aboutInstructor: RichTextDoc | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    await db
      .update(tenants)
      .set({
        aboutInstructor: data.aboutInstructor,
      })
      .where(eq(tenants.id, user.tenantId));

    return { ok: true };
  });
