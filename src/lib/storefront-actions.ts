import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq, and, asc } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { courses, modules, lessons, tenants } from "#/db/schema/index.ts";
import { extractSubdomain } from "#/middleware/tenant.ts";
import { createPresignedDownloadUrl } from "./storage/s3.ts";

/**
 * Resolve the tenant from the current request headers.
 * Used by public storefront pages (no auth required).
 */
async function requireTenant() {
  const request = getRequest();
  const host = request.headers.get("x-tenant") ?? request.headers.get("host") ?? "";

  const columns = {
    id: true,
    name: true,
    subdomain: true,
    stripeConnectAccountId: true,
    subscriptionPrice: true,
    gaTrackingId: true,
    fbPixelId: true,
    aboutInstructor: true,
    logoUrl: true,
    faviconUrl: true,
    primaryColor: true,
    accentColor: true,
    brandName: true,
  } as const;

  // Try subdomain first, then custom domain
  const subdomain = extractSubdomain(host);
  let tenant;

  if (subdomain) {
    tenant = await db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
      columns,
    });
  } else {
    const hostname = host.split(":")[0];
    if (hostname && hostname !== "localhost") {
      tenant = await db.query.tenants.findFirst({
        where: eq(tenants.customDomain, hostname),
        columns,
      });
    }
  }

  if (!tenant) throw new Error("Tenant not found");

  // Resolve branding image S3 keys to presigned download URLs
  let resolvedLogoUrl = tenant.logoUrl;
  let resolvedFaviconUrl = tenant.faviconUrl;
  try {
    if (tenant.logoUrl) {
      const { url } = await createPresignedDownloadUrl({
        key: tenant.logoUrl,
        expiresInSeconds: 86400,
      });
      resolvedLogoUrl = url;
    }
    if (tenant.faviconUrl) {
      const { url } = await createPresignedDownloadUrl({
        key: tenant.faviconUrl,
        expiresInSeconds: 86400,
      });
      resolvedFaviconUrl = url;
    }
  } catch {
    // If S3 is unavailable, fall back to null
    resolvedLogoUrl = null;
    resolvedFaviconUrl = null;
  }

  return { ...tenant, logoUrl: resolvedLogoUrl, faviconUrl: resolvedFaviconUrl };
}

/**
 * List published courses for the current tenant.
 * Public — no auth required.
 */
export const listPublishedCoursesFn = createServerFn({ method: "GET" }).handler(async () => {
  const tenant = await requireTenant();
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      thumbnailUrl: courses.thumbnailUrl,
      price: courses.price,
      pricingModel: courses.pricingModel,
    })
    .from(courses)
    .where(and(eq(courses.tenantId, tenant.id), eq(courses.status, "published")))
    .orderBy(courses.createdAt);
  return { tenant, courses: rows };
});

/**
 * Get a single published course by slug, with its full curriculum outline
 * (module titles + lesson titles only — no content).
 * Public — no auth required.
 */
export const getCourseBySlugFn = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const tenant = await requireTenant();

    const [course] = await db
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.tenantId, tenant.id),
          eq(courses.slug, data.slug),
          eq(courses.status, "published"),
        ),
      );
    if (!course) throw new Error("Course not found");

    // Fetch modules with their lessons (titles only)
    const courseModules = await db
      .select({
        id: modules.id,
        title: modules.title,
        position: modules.position,
      })
      .from(modules)
      .where(eq(modules.courseId, course.id))
      .orderBy(asc(modules.position));

    const curriculum = await Promise.all(
      courseModules.map(async (mod) => {
        const modLessons = await db
          .select({
            id: lessons.id,
            title: lessons.title,
            type: lessons.type,
            position: lessons.position,
          })
          .from(lessons)
          .where(eq(lessons.moduleId, mod.id))
          .orderBy(asc(lessons.position));
        return { ...mod, lessons: modLessons };
      }),
    );

    return { tenant, course, curriculum };
  });
