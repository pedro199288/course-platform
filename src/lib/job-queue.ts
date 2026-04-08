import PgBoss from "pg-boss";

let boss: PgBoss | null = null;

/**
 * Get or create the PgBoss instance. Reuses a singleton so multiple
 * callers (auth hooks, API routes, etc.) share the same connection.
 */
export function getBoss(): PgBoss {
  if (!boss) {
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      // Maintenance runs every 2 minutes by default; keep it
      retryBackoff: true, // exponential backoff on retries
      retryLimit: 3, // retry failed jobs up to 3 times
    });
  }
  return boss;
}

/**
 * Start the queue. Call once during server startup.
 * Idempotent — calling multiple times is safe.
 */
export async function startJobQueue(): Promise<PgBoss> {
  const b = getBoss();
  await b.start();
  return b;
}

/**
 * Stop the queue gracefully. Call during server shutdown.
 */
export async function stopJobQueue(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true });
    boss = null;
  }
}

// ---------------------------------------------------------------------------
// Job handler registry
// ---------------------------------------------------------------------------

export type JobHandler<T = unknown> = (data: T) => Promise<void>;

const handlers = new Map<string, JobHandler<any>>();

/**
 * Register a named job handler. Must be called before `startWorkers()`.
 *
 * @example
 * registerHandler("send_email", async (data: { to: string; subject: string; html: string }) => {
 *   await sendEmail(data);
 * });
 */
export function registerHandler<T = unknown>(
  name: string,
  handler: JobHandler<T>,
): void {
  handlers.set(name, handler);
}

/**
 * Start workers for all registered handlers.
 * Call after `startJobQueue()` and after all handlers are registered.
 */
export async function startWorkers(): Promise<void> {
  const b = getBoss();
  for (const [name, handler] of handlers) {
    await b.work(name, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Job dispatch
// ---------------------------------------------------------------------------

export interface SendOptions {
  /** Delay before the job becomes visible, in seconds */
  startAfter?: number;
  /** Number of retry attempts (overrides global default) */
  retryLimit?: number;
  /** Use exponential backoff on retries (overrides global default) */
  retryBackoff?: boolean;
  /** Unique key — if a job with this key is already active, the send is a no-op */
  singletonKey?: string;
}

/**
 * Enqueue a job for background processing.
 *
 * @example
 * await sendJob("send_email", { to: "user@example.com", subject: "Welcome", html: "<h1>Hi</h1>" });
 */
export async function sendJob<T = unknown>(
  name: string,
  data: T,
  options: SendOptions = {},
): Promise<string | null> {
  const b = getBoss();
  const id = await b.send(name, data as object, {
    startAfter: options.startAfter,
    retryLimit: options.retryLimit,
    retryBackoff: options.retryBackoff,
    singletonKey: options.singletonKey,
  });
  return id;
}
