import { describe, expect, it, vi } from "vite-plus/test";
import {
  renderVerifyEmail,
  renderResetPassword,
} from "#/lib/email-templates/index.ts";

describe("email templates", () => {
  it("renders verify email template with verification link", async () => {
    const html = await renderVerifyEmail({
      verificationUrl: "https://school.platform.com/api/auth/verify-email?token=abc123",
    });

    expect(html).toContain("Verify your email");
    expect(html).toContain("https://school.platform.com/api/auth/verify-email?token=abc123");
    expect(html).toContain("Verify Email");
  });

  it("renders reset password template with reset link and expiry note", async () => {
    const html = await renderResetPassword({
      resetUrl: "https://school.platform.com/reset-password?token=xyz789",
    });

    expect(html).toContain("Reset your password");
    expect(html).toContain("https://school.platform.com/reset-password?token=xyz789");
    expect(html).toContain("30 minutes");
    expect(html).toContain("Reset Password");
  });
});

describe("sendEmail", () => {
  it("calls Resend API with correct parameters", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      data: { id: "test-email-id" },
      error: null,
    });

    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: { send: mockSend },
      })),
    }));

    const { sendEmail } = await import("#/lib/email.ts");

    await sendEmail({
      to: "user@example.com",
      subject: "Test Subject",
      html: "<p>Test</p>",
    });

    expect(mockSend).toHaveBeenCalledWith({
      from: expect.any(String),
      to: "user@example.com",
      subject: "Test Subject",
      html: "<p>Test</p>",
    });
  });

  it("throws on Resend API error", async () => {
    const mockSend = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Invalid API key" },
    });

    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: { send: mockSend },
      })),
    }));

    const { sendEmail } = await import("#/lib/email.ts");

    await expect(
      sendEmail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>Test</p>",
      }),
    ).rejects.toThrow("Failed to send email: Invalid API key");
  });
});
