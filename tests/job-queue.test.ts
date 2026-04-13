import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

// PgBoss polls at intervals; give integration tests enough time
vi.setConfig({ testTimeout: 30_000 });
import PgBoss from "pg-boss";

// Use a dedicated PgBoss instance for tests to avoid conflicts with app code.
// We don't import from the app module to keep test isolation clean.
let boss: PgBoss;

beforeAll(async () => {
  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    retryBackoff: true,
    retryLimit: 3,
  });
  await boss.start();
});

afterAll(async () => {
  if (boss) {
    await boss.stop({ graceful: true });
  }
});

describe("job queue: enqueue and execute", () => {
  it("enqueues a job and returns a job ID", async () => {
    const queue = `test-enqueue-${Date.now()}`;
    await boss.createQueue(queue);
    const jobId = await boss.send(queue, { message: "hello" });

    expect(jobId).toBeTruthy();
    expect(typeof jobId).toBe("string");
  });

  it("worker receives and processes the enqueued job data", async () => {
    const queue = `test-execute-${Date.now()}`;
    await boss.createQueue(queue);
    let receivedData: unknown = null;
    const done = new Promise<void>((resolve) => {
      boss.work(queue, async (jobs) => {
        receivedData = jobs[0].data;
        resolve();
      });
    });

    await boss.send(queue, { key: "value", num: 42 });

    // Wait for the worker to pick up the job (pgboss polls at intervals)
    await Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Job not processed within 15s")), 15_000),
      ),
    ]);

    expect(receivedData).toEqual({ key: "value", num: 42 });
  });

  it("job marked as completed after successful handler", async () => {
    const queue = `test-complete-${Date.now()}`;
    await boss.createQueue(queue);
    const processed = new Promise<string>((resolve) => {
      boss.work(queue, async (jobs) => {
        resolve(jobs[0].id);
      });
    });

    const jobId = await boss.send(queue, { x: 1 });

    const completedJobId = await Promise.race([
      processed,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15_000)),
    ]);

    expect(completedJobId).toBe(jobId);

    // After completion, fetching the job should return empty (consumed)
    const fetched = await boss.fetch(queue);
    expect(fetched).toHaveLength(0);
  });
});

describe("job queue: retry behavior", () => {
  it("retries a failed job up to the configured limit", async () => {
    const queue = `test-retry-${Date.now()}`;
    await boss.createQueue(queue);
    let attempts = 0;
    const allDone = new Promise<number>((resolve) => {
      boss.work(queue, async (jobs) => {
        for (const _job of jobs) {
          attempts++;
          if (attempts < 3) {
            throw new Error(`Fail attempt ${attempts}`);
          }
          // Succeed on 3rd attempt
          resolve(attempts);
        }
      });
    });

    await boss.send(queue, { retry: true }, { retryLimit: 3, retryBackoff: false, retryDelay: 1 });

    const finalAttempts = await Promise.race([
      allDone,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("Retry test timed out after 30s")), 30_000),
      ),
    ]);

    expect(finalAttempts).toBe(3);
  });
});

describe("job queue: app module API", () => {
  it("exports getBoss, startJobQueue, stopJobQueue, sendJob, registerHandler, startWorkers", async () => {
    const mod = await import("#/lib/job-queue.ts");

    expect(typeof mod.getBoss).toBe("function");
    expect(typeof mod.startJobQueue).toBe("function");
    expect(typeof mod.stopJobQueue).toBe("function");
    expect(typeof mod.sendJob).toBe("function");
    expect(typeof mod.registerHandler).toBe("function");
    expect(typeof mod.startWorkers).toBe("function");
  });

  it("sendJob enqueues via the app module and worker picks it up", async () => {
    // Import fresh to avoid singleton conflicts with the test PgBoss instance
    const { startJobQueue, stopJobQueue, sendJob, registerHandler, startWorkers } =
      await import("#/lib/job-queue.ts");

    await startJobQueue();
    const queue = `test-app-api-${Date.now()}`;

    let receivedData: unknown = null;
    const done = new Promise<void>((resolve) => {
      registerHandler(queue, async (data) => {
        receivedData = data;
        resolve();
      });
    });

    await startWorkers();
    await sendJob(queue, { from: "app-module" });

    await Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("App module job not processed within 15s")), 15_000),
      ),
    ]);

    expect(receivedData).toEqual({ from: "app-module" });

    await stopJobQueue();
  });
});
