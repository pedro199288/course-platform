import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useRef } from "react";
import {
  getTenantSettingsFn,
  updateTrackingIdsFn,
  updateAboutInstructorFn,
  updateBrandingFn,
  getBrandingUploadUrlFn,
  saveBrandingImageFn,
  updateCustomDomainFn,
} from "#/lib/tenant-settings-actions.ts";
import {
  listTeamMembersFn,
  inviteTenantAdminFn,
  revokeInvitationFn,
  removeTeamMemberFn,
} from "#/lib/invitation-actions.ts";
import { RichTextEditor } from "#/components/RichTextEditor.tsx";
import { isRichTextDoc, type RichTextDoc } from "#/lib/rich-text/types.ts";

export const Route = createFileRoute("/admin/settings")({
  loader: async () => {
    const [settings, team] = await Promise.all([
      getTenantSettingsFn(),
      listTeamMembersFn().catch(() => null),
    ]);
    return { settings, team };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, team } = Route.useLoaderData();

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/admin"
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
        >
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">School Settings</h1>
      </div>

      {team && <TeamSection members={team.members} pendingInvitations={team.pendingInvitations} />}

      <CustomDomainSection customDomain={settings.customDomain} />

      <BrandingSection
        logoPreviewUrl={settings.logoPreviewUrl}
        faviconPreviewUrl={settings.faviconPreviewUrl}
        primaryColor={settings.primaryColor}
        accentColor={settings.accentColor}
        brandName={settings.brandName}
      />

      <TrackingSection gaTrackingId={settings.gaTrackingId} fbPixelId={settings.fbPixelId} />

      <AboutSection
        aboutInstructor={isRichTextDoc(settings.aboutInstructor) ? settings.aboutInstructor : null}
      />
    </div>
  );
}

function CustomDomainSection({ customDomain }: { customDomain: string | null }) {
  const router = useRouter();
  const [domain, setDomain] = useState(customDomain ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateCustomDomainFn({
        data: { customDomain: domain.trim() || null },
      });
      setSaved(true);
      void router.invalidate();
    } catch (err: any) {
      setError(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Custom Domain</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Serve your school from your own domain. SSL certificates are provisioned automatically.
      </p>
      <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="customDomain" className="block text-sm font-medium">
            Domain
          </label>
          <input
            id="customDomain"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="cursos.example.com"
            className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Enter a bare domain without http:// (e.g. cursos.example.com)
          </p>
        </div>

        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <h3 className="text-sm font-medium">DNS Configuration</h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Add a CNAME record pointing your domain to the platform:
          </p>
          <div className="mt-2 rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">
            <div className="grid grid-cols-3 gap-2">
              <span className="text-neutral-500">Type</span>
              <span className="text-neutral-500">Name</span>
              <span className="text-neutral-500">Value</span>
              <span>CNAME</span>
              <span>{domain || "cursos"}</span>
              <span>
                {typeof window !== "undefined" ? window.location.hostname : "platform.com"}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            DNS changes may take up to 48 hours to propagate. SSL will be provisioned automatically
            once DNS is configured correctly.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {saving ? "Saving..." : "Save Domain"}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </form>
    </div>
  );
}

function TrackingSection({
  gaTrackingId,
  fbPixelId,
}: {
  gaTrackingId: string | null;
  fbPixelId: string | null;
}) {
  const router = useRouter();
  const [ga, setGa] = useState(gaTrackingId ?? "");
  const [fb, setFb] = useState(fbPixelId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateTrackingIdsFn({
        data: {
          gaTrackingId: ga.trim() || null,
          fbPixelId: fb.trim() || null,
        },
      });
      setSaved(true);
      void router.invalidate();
    } catch (err: any) {
      setError(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Third-Party Tracking</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Add tracking IDs to inject analytics scripts on your storefront pages.
      </p>
      <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="gaTrackingId" className="block text-sm font-medium">
            Google Analytics Tracking ID
          </label>
          <input
            id="gaTrackingId"
            type="text"
            value={ga}
            onChange={(e) => setGa(e.target.value)}
            placeholder="G-XXXXXXXXXX"
            className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Supports GA4 (G-XXXXXXX) and Universal Analytics (UA-XXXXX-X)
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="fbPixelId" className="block text-sm font-medium">
            Facebook Pixel ID
          </label>
          <input
            id="fbPixelId"
            type="text"
            value={fb}
            onChange={(e) => setFb(e.target.value)}
            placeholder="1234567890"
            className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Numeric ID from your Facebook Ads Manager
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {saving ? "Saving..." : "Save Tracking IDs"}
          </button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </form>
    </div>
  );
}

function AboutSection({ aboutInstructor }: { aboutInstructor: RichTextDoc | null }) {
  const router = useRouter();
  const [content, setContent] = useState<RichTextDoc | null>(aboutInstructor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateAboutInstructorFn({
        data: { aboutInstructor: content },
      });
      setSaved(true);
      void router.invalidate();
    } catch {
      alert("Failed to save about section");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">About the Instructor</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Write a bio that will be displayed on your storefront. Tell students about your credentials
        and experience.
      </p>
      <div className="mt-4 max-w-2xl">
        <RichTextEditor
          value={content}
          onChange={setContent}
          placeholder="Tell your students about yourself..."
          ariaLabel="About the instructor"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? "Saving..." : "Save About Section"}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
      </div>
    </div>
  );
}

function BrandingSection({
  logoPreviewUrl,
  faviconPreviewUrl,
  primaryColor: initialPrimary,
  accentColor: initialAccent,
  brandName: initialBrandName,
}: {
  logoPreviewUrl: string | null;
  faviconPreviewUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  brandName: string | null;
}) {
  const router = useRouter();
  const [primary, setPrimary] = useState(initialPrimary ?? "");
  const [accent, setAccent] = useState(initialAccent ?? "");
  const [brandName, setBrandName] = useState(initialBrandName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveBranding(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateBrandingFn({
        data: {
          primaryColor: primary.trim() || null,
          accentColor: accent.trim() || null,
          brandName: brandName.trim() || null,
        },
      });
      setSaved(true);
      void router.invalidate();
    } catch (err: any) {
      setError(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Branding</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Customize your school&apos;s logo, favicon, colors, and display name. When configured,
        platform branding is hidden from your storefront.
      </p>

      <div className="mt-4 space-y-6">
        {/* Logo upload */}
        <ImageUploadField
          label="Logo"
          field="logo"
          previewUrl={logoPreviewUrl}
          hint="Recommended: 200×50px or larger, PNG/SVG/WebP"
        />

        {/* Favicon upload */}
        <ImageUploadField
          label="Favicon"
          field="favicon"
          previewUrl={faviconPreviewUrl}
          hint="Recommended: 32×32px or 64×64px, PNG/ICO"
        />

        {/* Colors + brand name form */}
        <form onSubmit={(e) => void handleSaveBranding(e)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="brandName" className="block text-sm font-medium">
              Brand Name
            </label>
            <input
              id="brandName"
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="My School"
              className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Displayed on your storefront instead of the tenant name
            </p>
          </div>

          <div className="flex gap-6">
            <div className="space-y-1.5">
              <label htmlFor="primaryColor" className="block text-sm font-medium">
                Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primary || "#000000"}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-9 w-9 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                />
                <input
                  id="primaryColor"
                  type="text"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  placeholder="#000000"
                  className="w-28 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">Buttons and CTAs</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="accentColor" className="block text-sm font-medium">
                Accent Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accent || "#4fb8b2"}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-9 w-9 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                />
                <input
                  id="accentColor"
                  type="text"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  placeholder="#4fb8b2"
                  className="w-28 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">Links and highlights</p>
            </div>
          </div>

          {/* Preview swatch */}
          {(primary || accent) && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">Preview:</span>
              {primary && (
                <span
                  className="inline-block h-6 rounded px-3 text-xs font-medium leading-6 text-white"
                  style={{ backgroundColor: primary }}
                >
                  Button
                </span>
              )}
              {accent && (
                <span className="text-sm font-medium" style={{ color: accent }}>
                  Link text
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {saving ? "Saving..." : "Save Branding"}
            </button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
            {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function ImageUploadField({
  label,
  field,
  previewUrl,
  hint,
}: {
  label: string;
  field: "logo" | "favicon";
  previewUrl: string | null;
  hint: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(previewUrl);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      // Get presigned upload URL
      const { uploadUrl, key } = await getBrandingUploadUrlFn({
        data: { field, contentType: file.type },
      });

      // Upload directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      // Save S3 key to tenant
      await saveBrandingImageFn({ data: { field, key } });

      // Show local preview
      setPreview(URL.createObjectURL(file));
      void router.invalidate();
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setUploading(true);
    setError(null);
    try {
      await saveBrandingImageFn({ data: { field, key: null } });
      setPreview(null);
      void router.invalidate();
    } catch (err: any) {
      setError(err.message ?? "Failed to remove");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-4">
        {preview ? (
          <div className="flex items-center gap-3">
            <img
              src={preview}
              alt={`${label} preview`}
              className={
                field === "logo" ? "h-10 max-w-[200px] object-contain" : "h-8 w-8 object-contain"
              }
            />
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={uploading}
              className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Remove
            </button>
          </div>
        ) : (
          <div
            className={`flex items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 ${
              field === "logo" ? "h-12 w-48" : "h-10 w-10"
            }`}
          >
            <span className="text-xs text-neutral-400">No {label.toLowerCase()}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {uploading ? "Uploading..." : preview ? "Change" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon"
          onChange={(e) => void handleFileChange(e)}
          className="hidden"
        />
      </div>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function TeamSection({
  members: initialMembers,
  pendingInvitations: initialInvitations,
}: {
  members: Array<{
    userId: string;
    role: string;
    createdAt: Date;
    name: string | null;
    email: string;
  }>;
  pendingInvitations: Array<{
    id: string;
    email: string;
    role: string;
    createdAt: Date;
    expiresAt: Date;
  }>;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      const result = await inviteTenantAdminFn({ data: { email: email.trim() } });
      setEmail("");
      setMessage({
        type: "success",
        text: result.status === "membership_created" ? "User added as admin" : "Invitation sent",
      });
      void router.invalidate();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Failed to invite" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    try {
      await revokeInvitationFn({ data: { invitationId } });
      void router.invalidate();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Failed to revoke" });
    }
  }

  async function handleRemove(memberUserId: string) {
    try {
      await removeTeamMemberFn({ data: { memberUserId } });
      void router.invalidate();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message ?? "Failed to remove" });
    }
  }

  const roleLabel = (role: string) => {
    switch (role) {
      case "tenant_owner":
        return "Owner";
      case "tenant_admin":
        return "Admin";
      case "student":
        return "Student";
      default:
        return role;
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold">Team Members</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Manage who has admin access to your school.
      </p>

      {/* Invite form */}
      <form onSubmit={(e) => void handleInvite(e)} className="mt-4 flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="inviteEmail" className="block text-sm font-medium">
            Invite Admin
          </label>
          <input
            id="inviteEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <button
          type="submit"
          disabled={inviting || !email.trim()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {inviting ? "Inviting..." : "Send Invite"}
        </button>
      </form>
      {message && (
        <p
          className={`mt-2 text-sm ${message.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
        >
          {message.text}
        </p>
      )}

      {/* Current members */}
      <div className="mt-6">
        <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Current Members
        </h3>
        <div className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
          {initialMembers.map((member) => (
            <div key={member.userId} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="text-sm font-medium">{member.name || member.email}</span>
                {member.name && (
                  <span className="ml-2 text-xs text-neutral-500">{member.email}</span>
                )}
                <span className="ml-2 inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {roleLabel(member.role)}
                </span>
              </div>
              {member.role !== "tenant_owner" && (
                <button
                  type="button"
                  onClick={() => void handleRemove(member.userId)}
                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invitations */}
      {initialInvitations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Pending Invitations
          </h3>
          <div className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
            {initialInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm">{inv.email}</span>
                  <span className="ml-2 inline-block rounded bg-yellow-50 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Pending
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(inv.id)}
                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
