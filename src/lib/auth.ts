import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/index.ts";
import * as schema from "#/db/schema/index.ts";
import { auditLogs } from "#/db/schema/audit-logs.ts";
import { tenantIdStore } from "./tenant-context.ts";
import { sendEmail } from "./email.ts";
import { renderVerifyEmail, renderResetPassword } from "./email-templates/index.ts";
import { BASE_URL, PORT } from "./config.ts";
import { claimPendingInvitations } from "./invitation-actions.ts";

const isProduction = process.env.NODE_ENV === "production";

const trustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
  : [`*.localhost:${PORT}`];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      rateLimit: schema.rateLimit,
    },
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (!user) return;
          const u = user as { id: string; email?: string };
          if (u.email) {
            await claimPendingInvitations(u.email, u.id).catch(() => {});
          }
        },
      },
      update: {
        after: async (user) => {
          if (!user) return;
          const tenantId = tenantIdStore.getStore();
          await db.insert(auditLogs).values({
            event: "user.updated",
            actorId: (user as any).id,
            tenantId: tenantId ?? null,
            metadata: { email: (user as any).email },
          });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          const tenantId = tenantIdStore.getStore();
          await db.insert(auditLogs).values({
            event: "session.created",
            actorId: session.userId as string,
            tenantId,
            metadata: {
              ipAddress: (session as any).ipAddress ?? null,
              userAgent: (session as any).userAgent ?? null,
            },
          });
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          const tenantId = tenantIdStore.getStore();
          await db.insert(auditLogs).values({
            event: "account.linked",
            actorId: account.userId as string,
            tenantId,
            metadata: {
              providerId: account.providerId,
            },
          });
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 1800, // 30 minutes
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const html = await renderResetPassword({ resetUrl: url });
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        html,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const html = await renderVerifyEmail({ verificationUrl: url });
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        html,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  account: {
    encryptOAuthTokens: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
      strategy: "jwe", // Encrypted — session contains user-level data only
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 10,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: isProduction,
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
    },
    database: {
      generateId: false, // Let PostgreSQL generate UUIDs via defaultRandom()
    },
    crossSubDomainCookies: {
      enabled: true,
      domain: isProduction
        ? `.${new URL(BASE_URL).hostname.split(".").slice(-2).join(".")}`
        : ".localhost",
    },
  },
  trustedOrigins,
  plugins: [tanstackStartCookies()],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
