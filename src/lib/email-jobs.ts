import { sendEmail } from "./email.ts";
import { registerHandler, sendJob } from "./job-queue.ts";

// ---------------------------------------------------------------------------
// Job payload type
// ---------------------------------------------------------------------------

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  /** Optional per-tenant sender override (e.g. "School Name <noreply@school.com>") */
  from?: string;
}

export const EMAIL_JOB_NAME = "send_email";

// ---------------------------------------------------------------------------
// Handler registration — call once at startup before startWorkers()
// ---------------------------------------------------------------------------

export function registerEmailHandler(): void {
  registerHandler<EmailJobData>(EMAIL_JOB_NAME, async (data) => {
    await sendEmail({
      to: data.to,
      subject: data.subject,
      html: data.html,
      from: data.from,
    });
  });
}

// ---------------------------------------------------------------------------
// Enqueue helpers
// ---------------------------------------------------------------------------

/**
 * Enqueue a raw email for background delivery.
 * Retries with exponential backoff are handled by the job queue.
 */
export async function enqueueEmail(data: EmailJobData): Promise<string | null> {
  return sendJob<EmailJobData>(EMAIL_JOB_NAME, data);
}

/**
 * Enqueue a purchase confirmation email.
 */
export async function enqueuePurchaseConfirmation(opts: {
  to: string;
  studentName: string;
  courseName: string;
  amount: string;
  currency: string;
  schoolName: string;
  from?: string;
}): Promise<string | null> {
  const { renderPurchaseConfirmation } =
    await import("./email-templates/purchase-confirmation.tsx");
  const html = await renderPurchaseConfirmation({
    studentName: opts.studentName,
    courseName: opts.courseName,
    amount: opts.amount,
    currency: opts.currency,
    schoolName: opts.schoolName,
  });
  return enqueueEmail({
    to: opts.to,
    subject: `Purchase confirmed — ${opts.courseName}`,
    html,
    from: opts.from,
  });
}

/**
 * Enqueue an enrollment confirmation email.
 */
export async function enqueueEnrollmentConfirmation(opts: {
  to: string;
  studentName: string;
  courseName: string;
  schoolName: string;
  courseUrl: string;
  from?: string;
}): Promise<string | null> {
  const { renderEnrollmentConfirmation } =
    await import("./email-templates/enrollment-confirmation.tsx");
  const html = await renderEnrollmentConfirmation({
    studentName: opts.studentName,
    courseName: opts.courseName,
    schoolName: opts.schoolName,
    courseUrl: opts.courseUrl,
  });
  return enqueueEmail({
    to: opts.to,
    subject: `You're enrolled in ${opts.courseName}`,
    html,
    from: opts.from,
  });
}

/**
 * Enqueue a certificate delivery email.
 */
export async function enqueueCertificateDelivery(opts: {
  to: string;
  studentName: string;
  courseName: string;
  schoolName: string;
  certificateUrl: string;
  completionDate: string;
  from?: string;
}): Promise<string | null> {
  const { renderCertificateDelivery } = await import("./email-templates/certificate-delivery.tsx");
  const html = await renderCertificateDelivery({
    studentName: opts.studentName,
    courseName: opts.courseName,
    schoolName: opts.schoolName,
    certificateUrl: opts.certificateUrl,
    completionDate: opts.completionDate,
  });
  return enqueueEmail({
    to: opts.to,
    subject: `Your certificate for ${opts.courseName} is ready`,
    html,
    from: opts.from,
  });
}

/**
 * Enqueue a bulk email to a course student.
 */
export async function enqueueBulkEmail(opts: {
  to: string;
  studentName: string;
  courseName: string;
  schoolName: string;
  subject: string;
  body: string;
  from?: string;
}): Promise<string | null> {
  const { renderBulkEmail } = await import("./email-templates/bulk-email.tsx");
  const html = await renderBulkEmail({
    studentName: opts.studentName,
    courseName: opts.courseName,
    schoolName: opts.schoolName,
    subject: opts.subject,
    body: opts.body,
  });
  return enqueueEmail({
    to: opts.to,
    subject: `${opts.subject} — ${opts.courseName}`,
    html,
    from: opts.from,
  });
}

/**
 * Enqueue a course announcement email.
 */
export async function enqueueAnnouncementEmail(opts: {
  to: string;
  studentName: string;
  courseName: string;
  schoolName: string;
  announcementTitle: string;
  announcementBody: string;
  from?: string;
}): Promise<string | null> {
  const { renderCourseAnnouncement } = await import("./email-templates/course-announcement.tsx");
  const html = await renderCourseAnnouncement({
    studentName: opts.studentName,
    courseName: opts.courseName,
    schoolName: opts.schoolName,
    announcementTitle: opts.announcementTitle,
    announcementBody: opts.announcementBody,
  });
  return enqueueEmail({
    to: opts.to,
    subject: `${opts.announcementTitle} — ${opts.courseName}`,
    html,
    from: opts.from,
  });
}
