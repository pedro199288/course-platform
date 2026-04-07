import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const emailFrom = process.env.EMAIL_FROM || "noreply@platform.com";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
  const { data, error } = await resend.emails.send({
    from: emailFrom,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}
