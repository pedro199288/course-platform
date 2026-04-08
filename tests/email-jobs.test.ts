import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// ---------------------------------------------------------------------------
// Mock the email module so tests never hit the Resend API
// ---------------------------------------------------------------------------
vi.mock("#/lib/email.ts", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
}));

import { sendEmail } from "#/lib/email.ts";

// ---------------------------------------------------------------------------
// Template rendering tests (no job queue needed)
// ---------------------------------------------------------------------------

describe("email templates: rendering", () => {
  it("purchase confirmation renders with course and amount details", async () => {
    const { renderPurchaseConfirmation } = await import(
      "#/lib/email-templates/purchase-confirmation.tsx"
    );
    const html = await renderPurchaseConfirmation({
      studentName: "Alice",
      courseName: "Intro to TypeScript",
      amount: "49.99",
      currency: "usd",
      schoolName: "Code Academy",
    });

    expect(html).toContain("Alice");
    expect(html).toContain("Intro to TypeScript");
    expect(html).toContain("USD 49.99");
    expect(html).toContain("Code Academy");
    expect(html).toContain("Purchase Confirmed");
  });

  it("enrollment confirmation renders with course link", async () => {
    const { renderEnrollmentConfirmation } = await import(
      "#/lib/email-templates/enrollment-confirmation.tsx"
    );
    const html = await renderEnrollmentConfirmation({
      studentName: "Bob",
      courseName: "Advanced React",
      schoolName: "React School",
      courseUrl: "https://react.school.com/courses/advanced-react",
    });

    expect(html).toContain("Bob");
    expect(html).toContain("Advanced React");
    expect(html).toContain("React School");
    expect(html).toContain("https://react.school.com/courses/advanced-react");
    expect(html).toContain("Start Learning");
  });

  it("certificate delivery renders with completion date and download link", async () => {
    const { renderCertificateDelivery } = await import(
      "#/lib/email-templates/certificate-delivery.tsx"
    );
    const html = await renderCertificateDelivery({
      studentName: "Carol",
      courseName: "Data Science 101",
      schoolName: "Data Lab",
      certificateUrl: "https://data.lab.com/certificates/abc123",
      completionDate: "April 8, 2026",
    });

    expect(html).toContain("Carol");
    expect(html).toContain("Data Science 101");
    expect(html).toContain("Data Lab");
    expect(html).toContain("https://data.lab.com/certificates/abc123");
    expect(html).toContain("April 8, 2026");
    expect(html).toContain("Download Certificate");
    expect(html).toContain("Congratulations");
  });
});

// ---------------------------------------------------------------------------
// Email job module tests (uses real PgBoss for integration)
// ---------------------------------------------------------------------------

import PgBoss from "pg-boss";

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

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
});

describe("email jobs: enqueue and handler", () => {
  it("registerEmailHandler registers the send_email handler", async () => {
    const { registerEmailHandler, EMAIL_JOB_NAME } = await import(
      "#/lib/email-jobs.ts"
    );

    // Should not throw
    registerEmailHandler();
    expect(EMAIL_JOB_NAME).toBe("send_email");
  });

  it("enqueueEmail dispatches a job to the queue", async () => {
    const { enqueueEmail } = await import("#/lib/email-jobs.ts");

    // Need the app job queue running for enqueueEmail
    const { startJobQueue, stopJobQueue } = await import("#/lib/job-queue.ts");
    await startJobQueue();

    const jobId = await enqueueEmail({
      to: "test@example.com",
      subject: "Test Subject",
      html: "<p>Test</p>",
    });

    expect(jobId).toBeTruthy();
    expect(typeof jobId).toBe("string");

    await stopJobQueue();
  });

  it("send_email worker calls sendEmail with job data including optional from", async () => {
    const { startJobQueue, stopJobQueue, startWorkers } = await import(
      "#/lib/job-queue.ts"
    );
    // Re-import to get fresh module with handler already registered from earlier test
    const { enqueueEmail } = await import("#/lib/email-jobs.ts");

    await startJobQueue();
    await startWorkers();

    const done = new Promise<void>((resolve) => {
      vi.mocked(sendEmail).mockImplementation(async () => {
        resolve();
        return { id: "mock-email-id" };
      });
    });

    await enqueueEmail({
      to: "student@example.com",
      subject: "Welcome",
      html: "<h1>Hi</h1>",
      from: "School <noreply@school.com>",
    });

    await Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Email job not processed within 15s")), 15_000),
      ),
    ]);

    expect(sendEmail).toHaveBeenCalledWith({
      to: "student@example.com",
      subject: "Welcome",
      html: "<h1>Hi</h1>",
      from: "School <noreply@school.com>",
    });

    await stopJobQueue();
  });

  it("enqueuePurchaseConfirmation enqueues a rendered purchase email", async () => {
    const { startJobQueue, stopJobQueue, startWorkers } = await import(
      "#/lib/job-queue.ts"
    );
    const { enqueuePurchaseConfirmation } = await import("#/lib/email-jobs.ts");

    await startJobQueue();
    await startWorkers();

    const done = new Promise<void>((resolve) => {
      vi.mocked(sendEmail).mockImplementation(async () => {
        resolve();
        return { id: "mock-email-id" };
      });
    });

    const jobId = await enqueuePurchaseConfirmation({
      to: "buyer@example.com",
      studentName: "Test Buyer",
      courseName: "Test Course",
      amount: "29.99",
      currency: "usd",
      schoolName: "Test School",
    });

    expect(jobId).toBeTruthy();

    await Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Purchase email not sent within 15s")), 15_000),
      ),
    ]);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe("buyer@example.com");
    expect(call.subject).toContain("Test Course");
    expect(call.html).toContain("Test Buyer");
    expect(call.html).toContain("USD 29.99");

    await stopJobQueue();
  });

  it("enqueueEnrollmentConfirmation enqueues a rendered enrollment email", async () => {
    const { startJobQueue, stopJobQueue, startWorkers } = await import(
      "#/lib/job-queue.ts"
    );
    const { enqueueEnrollmentConfirmation } = await import("#/lib/email-jobs.ts");

    await startJobQueue();
    await startWorkers();

    const done = new Promise<void>((resolve) => {
      vi.mocked(sendEmail).mockImplementation(async () => {
        resolve();
        return { id: "mock-email-id" };
      });
    });

    await enqueueEnrollmentConfirmation({
      to: "student@example.com",
      studentName: "Test Student",
      courseName: "React Mastery",
      schoolName: "Code School",
      courseUrl: "https://code.school.com/courses/react-mastery",
    });

    await Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Enrollment email not sent within 15s")), 15_000),
      ),
    ]);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe("student@example.com");
    expect(call.subject).toContain("React Mastery");
    expect(call.html).toContain("Test Student");
    expect(call.html).toContain("https://code.school.com/courses/react-mastery");

    await stopJobQueue();
  });

  it("enqueueCertificateDelivery enqueues a rendered certificate email", async () => {
    const { startJobQueue, stopJobQueue, startWorkers } = await import(
      "#/lib/job-queue.ts"
    );
    const { enqueueCertificateDelivery } = await import("#/lib/email-jobs.ts");

    await startJobQueue();
    await startWorkers();

    const done = new Promise<void>((resolve) => {
      vi.mocked(sendEmail).mockImplementation(async () => {
        resolve();
        return { id: "mock-email-id" };
      });
    });

    await enqueueCertificateDelivery({
      to: "grad@example.com",
      studentName: "Test Graduate",
      courseName: "Full Stack Dev",
      schoolName: "Dev Academy",
      certificateUrl: "https://dev.academy.com/certs/xyz",
      completionDate: "April 8, 2026",
    });

    await Promise.race([
      done,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Certificate email not sent within 15s")), 15_000),
      ),
    ]);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe("grad@example.com");
    expect(call.subject).toContain("Full Stack Dev");
    expect(call.html).toContain("Test Graduate");
    expect(call.html).toContain("April 8, 2026");
    expect(call.html).toContain("https://dev.academy.com/certs/xyz");

    await stopJobQueue();
  });
});
