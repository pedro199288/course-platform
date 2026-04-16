import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, asc, isNull } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { testimonials, tenants } from "#/db/schema/index.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";
import { requireMembership } from "./authorization.ts";

// ── Storefront helpers ──────────────────────────────────────────────

async function requireTenant() {
  const request = getRequest();
  const host = request.headers.get("x-tenant") ?? request.headers.get("host") ?? "";
  const subdomain = extractSubdomain(host);
  if (!subdomain) throw new Error("No tenant");

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.subdomain, subdomain),
    columns: { id: true, name: true, subdomain: true },
  });
  if (!tenant) throw new Error("Tenant not found");
  return tenant;
}

// ── Admin: CRUD ─────────────────────────────────────────────────────

export const listTestimonialsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantId } = await requireMembership("tenant_admin");
  return db
    .select()
    .from(testimonials)
    .where(eq(testimonials.tenantId, tenantId))
    .orderBy(asc(testimonials.position));
});

export const createTestimonialFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { courseId: string | null; authorName: string; body: string; rating: number | null }) => d,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    // Get current max position
    const existing = await db
      .select({ position: testimonials.position })
      .from(testimonials)
      .where(eq(testimonials.tenantId, tenantId))
      .orderBy(asc(testimonials.position));
    const nextPosition = existing.length > 0 ? existing[existing.length - 1].position + 1 : 0;

    const [testimonial] = await db
      .insert(testimonials)
      .values({
        tenantId: tenantId,
        courseId: data.courseId,
        authorName: data.authorName,
        body: data.body,
        rating: data.rating,
        position: nextPosition,
      })
      .returning();

    return testimonial;
  });

export const updateTestimonialFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      testimonialId: string;
      authorName: string;
      body: string;
      rating: number | null;
      courseId: string | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const [updated] = await db
      .update(testimonials)
      .set({
        authorName: data.authorName,
        body: data.body,
        rating: data.rating,
        courseId: data.courseId,
      })
      .where(and(eq(testimonials.id, data.testimonialId), eq(testimonials.tenantId, tenantId)))
      .returning();
    if (!updated) throw new Error("Testimonial not found");
    return updated;
  });

export const deleteTestimonialFn = createServerFn({ method: "POST" })
  .inputValidator((d: { testimonialId: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    const [deleted] = await db
      .delete(testimonials)
      .where(and(eq(testimonials.id, data.testimonialId), eq(testimonials.tenantId, tenantId)))
      .returning();
    if (!deleted) throw new Error("Testimonial not found");
    return deleted;
  });

export const reorderTestimonialsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { orderedIds: string[] }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");
    for (let i = 0; i < data.orderedIds.length; i++) {
      await db
        .update(testimonials)
        .set({ position: i })
        .where(and(eq(testimonials.id, data.orderedIds[i]), eq(testimonials.tenantId, tenantId)));
    }
    return { ok: true };
  });

// ── Storefront: Read ────────────────────────────────────────────────

/**
 * Get tenant-level testimonials (courseId is null) for the main catalog page.
 */
export const getStorefrontTestimonialsFn = createServerFn({ method: "GET" }).handler(async () => {
  const tenant = await requireTenant();
  return db
    .select({
      id: testimonials.id,
      authorName: testimonials.authorName,
      body: testimonials.body,
      rating: testimonials.rating,
      position: testimonials.position,
    })
    .from(testimonials)
    .where(and(eq(testimonials.tenantId, tenant.id), isNull(testimonials.courseId)))
    .orderBy(asc(testimonials.position));
});

/**
 * Get course-level testimonials for a specific course detail page.
 */
export const getCourseTestimonialsFn = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();
    return db
      .select({
        id: testimonials.id,
        authorName: testimonials.authorName,
        body: testimonials.body,
        rating: testimonials.rating,
        position: testimonials.position,
      })
      .from(testimonials)
      .where(and(eq(testimonials.tenantId, tenant.id), eq(testimonials.courseId, data.courseId)))
      .orderBy(asc(testimonials.position));
  });
