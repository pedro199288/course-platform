import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  listWebhookEndpointsFn,
  createWebhookEndpointFn,
  deleteWebhookEndpointFn,
  toggleWebhookEndpointFn,
  listWebhookDeliveriesFn,
} from "#/lib/webhook-endpoint-actions.ts";
import { WEBHOOK_EVENTS } from "#/lib/webhook-events.ts";

interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  responseBody: string | null;
  attemptNumber: number;
  deliveredAt: Date | null;
  createdAt: Date;
}

export const Route = createFileRoute("/admin/webhooks")({
  loader: () => listWebhookEndpointsFn(),
  component: WebhooksPage,
});

function WebhooksPage() {
  const endpoints = Route.useLoaderData() as WebhookEndpoint[];
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [viewingDeliveries, setViewingDeliveries] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Delete this webhook endpoint? All delivery history will be lost.")) return;
    await deleteWebhookEndpointFn({ data: { endpointId: id } });
    void router.invalidate();
  }

  async function handleToggle(id: string, active: boolean) {
    await toggleWebhookEndpointFn({ data: { endpointId: id, active } });
    void router.invalidate();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Send HTTP notifications when events occur on your school
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {showForm ? "Cancel" : "Add endpoint"}
        </button>
      </div>

      {showForm && (
        <EndpointForm
          onDone={() => {
            setShowForm(false);
            void router.invalidate();
          }}
        />
      )}

      {endpoints.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400">
            No webhook endpoints configured. Add one to receive event notifications.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <div key={ep.id}>
              <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${ep.active ? "bg-green-500" : "bg-neutral-400"}`}
                      />
                      <span className="font-mono text-sm break-all">{ep.url}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(ep.events as string[]).map((event) => (
                        <span
                          key={event}
                          className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        >
                          {event}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setViewingDeliveries(viewingDeliveries === ep.id ? null : ep.id)
                      }
                      className="rounded p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      title="View deliveries"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggle(ep.id, !ep.active)}
                      className="rounded p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      title={ep.active ? "Deactivate" : "Activate"}
                    >
                      {ep.active ? (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 5.25v13.5m-7.5-13.5v13.5"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(ep.id)}
                      className="rounded p-1 text-red-400 hover:text-red-600 dark:hover:text-red-300"
                      title="Delete"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Secret display */}
                <SecretDisplay secret={ep.secret} />
              </div>

              {viewingDeliveries === ep.id && <DeliveryLog endpointId={ep.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Secret display with copy ───────────────────────────────────────

function SecretDisplay({ secret }: { secret: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      <span>Secret:</span>
      <code className="font-mono">
        {revealed ? secret : `${secret.slice(0, 10)}${"*".repeat(20)}`}
      </code>
      <button
        type="button"
        onClick={() => setRevealed(!revealed)}
        className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        {revealed ? "Hide" : "Reveal"}
      </button>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// ── Delivery log ───────────────────────────────────────────────────

function DeliveryLog({ endpointId }: { endpointId: string }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    listWebhookDeliveriesFn({ data: { endpointId } })
      .then((d) => setDeliveries(d as WebhookDelivery[]))
      .catch(() => setDeliveries([]))
      .finally(() => setLoading(false));
  });

  if (loading) {
    return (
      <div className="mt-2 rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Loading deliveries...
      </div>
    );
  }

  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        No deliveries yet.
      </div>
    );
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
          <tr>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Attempt</th>
            <th className="px-3 py-2 font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
              <td className="px-3 py-2">
                {d.deliveredAt ? (
                  <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {d.statusCode}
                  </span>
                ) : d.statusCode ? (
                  <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {d.statusCode}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    pending
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-neutral-500">{d.attemptNumber}</td>
              <td className="px-3 py-2 text-neutral-500">
                {new Date(d.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Create endpoint form ───────────────────────────────────────────

function EndpointForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || selectedEvents.length === 0) return;
    setSaving(true);
    try {
      await createWebhookEndpointFn({
        data: { url: url.trim(), events: selectedEvents },
      });
      onDone();
    } catch (err: any) {
      alert(err.message ?? "Failed to create endpoint");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="space-y-1.5">
        <label htmlFor="webhook-url" className="block text-sm font-medium">
          Endpoint URL
        </label>
        <input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          placeholder="https://example.com/webhooks"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Events</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {WEBHOOK_EVENTS.map((event) => (
            <label
              key={event}
              className="flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <input
                type="checkbox"
                checked={selectedEvents.includes(event)}
                onChange={() => toggleEvent(event)}
                className="rounded border-neutral-300"
              />
              <span className="font-mono text-xs">{event}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || selectedEvents.length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {saving ? "Creating..." : "Create endpoint"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
