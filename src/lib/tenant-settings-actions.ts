import { createServerFn } from "@tanstack/react-start";
import { eq, and, ne } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants } from "#/db/schema/index.ts";
import type { RichTextDoc } from "#/lib/rich-text/types.ts";
import { createPresignedUploadUrl, createPresignedDownloadUrl } from "./storage/s3.ts";
import { requireMembership } from "./authorization.ts";

/**
 * Get tenant settings (tracking IDs + about instructor).
 */
export const getTenantSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantId } = await requireMembership("tenant_admin");
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: {
      gaTrackingId: true,
      fbPixelId: true,
      aboutInstructor: true,
      logoUrl: true,
      faviconUrl: true,
      primaryColor: true,
      accentColor: true,
      brandName: true,
      customDomain: true,
    },
  });
  if (!tenant) throw new Error("Tenant not found");

  // Resolve S3 keys to presigned URLs for admin preview
  let logoPreviewUrl: string | null = null;
  let faviconPreviewUrl: string | null = null;
  try {
    if (tenant.logoUrl) {
      const { url } = await createPresignedDownloadUrl({
        key: tenant.logoUrl,
        expiresInSeconds: 3600,
      });
      logoPreviewUrl = url;
    }
    if (tenant.faviconUrl) {
      const { url } = await createPresignedDownloadUrl({
        key: tenant.faviconUrl,
        expiresInSeconds: 3600,
      });
      faviconPreviewUrl = url;
    }
  } catch {
    // S3 unavailable — show no preview
  }

  return { ...tenant, logoPreviewUrl, faviconPreviewUrl };
});

/**
 * Update tracking IDs (GA + Facebook Pixel).
 */
export const updateTrackingIdsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { gaTrackingId: string | null; fbPixelId: string | null }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

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
      .where(eq(tenants.id, tenantId));

    return { ok: true };
  });

/**
 * Update the "About Instructor" rich text content.
 */
export const updateAboutInstructorFn = createServerFn({ method: "POST" })
  .inputValidator((d: { aboutInstructor: RichTextDoc | null }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    await db
      .update(tenants)
      .set({
        aboutInstructor: data.aboutInstructor,
      })
      .where(eq(tenants.id, tenantId));

    return { ok: true };
  });

/**
 * Update branding fields (colors + brand name).
 */
export const updateBrandingFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { primaryColor: string | null; accentColor: string | null; brandName: string | null }) => d,
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    if (data.primaryColor && !hexPattern.test(data.primaryColor)) {
      throw new Error("Invalid primary color format (use #RRGGBB)");
    }
    if (data.accentColor && !hexPattern.test(data.accentColor)) {
      throw new Error("Invalid accent color format (use #RRGGBB)");
    }
    if (data.brandName && data.brandName.length > 100) {
      throw new Error("Brand name must be 100 characters or fewer");
    }

    await db
      .update(tenants)
      .set({
        primaryColor: data.primaryColor || null,
        accentColor: data.accentColor || null,
        brandName: data.brandName?.trim() || null,
      })
      .where(eq(tenants.id, tenantId));

    return { ok: true };
  });

/**
 * Get a presigned upload URL for branding images (logo or favicon).
 */
export const getBrandingUploadUrlFn = createServerFn({ method: "POST" })
  .inputValidator((d: { field: "logo" | "favicon"; contentType: string }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    const allowedTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/x-icon"];
    if (!allowedTypes.includes(data.contentType)) {
      throw new Error("Invalid image type. Use PNG, JPEG, SVG, WebP, or ICO.");
    }

    const ext = data.contentType.split("/").pop()?.replace("x-icon", "ico") ?? "png";
    const key = `tenants/${tenantId}/branding/${data.field}.${ext}`;

    const { url } = await createPresignedUploadUrl({
      key,
      contentType: data.contentType,
      expiresInSeconds: 3600,
    });

    return { uploadUrl: url, key };
  });

/**
 * Save the S3 key for a branding image after upload completes.
 */
export const saveBrandingImageFn = createServerFn({ method: "POST" })
  .inputValidator((d: { field: "logo" | "favicon"; key: string | null }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    const setData = data.field === "logo" ? { logoUrl: data.key } : { faviconUrl: data.key };

    await db.update(tenants).set(setData).where(eq(tenants.id, tenantId));

    return { ok: true };
  });

/**
 * Update the custom domain for the current tenant.
 */
export const updateCustomDomainFn = createServerFn({ method: "POST" })
  .inputValidator((d: { customDomain: string | null }) => d)
  .handler(async ({ data }) => {
    const { tenantId } = await requireMembership("tenant_admin");

    const domain = data.customDomain?.trim().toLowerCase() || null;

    if (domain) {
      // Validate domain format (basic check: no protocol, no path, has a dot)
      if (
        domain.includes("://") ||
        domain.includes("/") ||
        domain.includes(" ") ||
        !domain.includes(".")
      ) {
        throw new Error("Invalid domain format. Enter a bare domain like cursos.example.com");
      }

      // Check uniqueness (another tenant may already have this domain)
      const existing = await db.query.tenants.findFirst({
        where: and(eq(tenants.customDomain, domain), ne(tenants.id, tenantId)),
        columns: { id: true },
      });
      if (existing) {
        throw new Error("This domain is already in use by another school");
      }
    }

    await db.update(tenants).set({ customDomain: domain }).where(eq(tenants.id, tenantId));

    return { ok: true };
  });
