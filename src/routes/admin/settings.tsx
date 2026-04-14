import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  getTenantSettingsFn,
  updateTrackingIdsFn,
  updateAboutInstructorFn,
} from "#/lib/tenant-settings-actions.ts";
import { RichTextEditor } from "#/components/RichTextEditor.tsx";
import { isRichTextDoc, type RichTextDoc } from "#/lib/rich-text/types.ts";

export const Route = createFileRoute("/admin/settings")({
  loader: () => getTenantSettingsFn(),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = Route.useLoaderData();

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

      <TrackingSection
        gaTrackingId={settings.gaTrackingId}
        fbPixelId={settings.fbPixelId}
      />

      <AboutSection
        aboutInstructor={
          isRichTextDoc(settings.aboutInstructor) ? settings.aboutInstructor : null
        }
      />
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
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
          )}
          {error && (
            <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
          )}
        </div>
      </form>
    </div>
  );
}

function AboutSection({
  aboutInstructor,
}: {
  aboutInstructor: RichTextDoc | null;
}) {
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
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
        )}
      </div>
    </div>
  );
}
