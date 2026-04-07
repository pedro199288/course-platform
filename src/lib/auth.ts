import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import * as schema from "#/db/schema/index.ts";
import { tenantIdStore } from "./tenant-context.ts";

const isProduction = process.env.NODE_ENV === "production";

const trustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
  : ["*.localhost:3000"];

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
        before: async (user) => {
          const tenantId = tenantIdStore.getStore();
          if (tenantId) {
            return {
              data: {
                ...user,
                tenantId,
                role: user.role || "student",
              },
            };
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
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
      tenantId: {
        type: "string",
        required: false,
        input: false,
      },
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
      strategy: "jwe", // Encrypted — session contains tenantId and role
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
      "/forget-password": { window: 60, max: 3 },
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
        ? `.${new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").hostname.split(".").slice(-2).join(".")}`
        : ".localhost",
    },
  },
  trustedOrigins,
  plugins: [tanstackStartCookies()],
});

/**
 * Patch findUserByEmail to scope user lookups by tenantId.
 *
 * Better Auth's internal findUserByEmail only filters by email. For multi-tenant
 * isolation (same email on different tenants), we replace it with a direct Drizzle
 * query that includes the tenantId from AsyncLocalStorage.
 *
 * This runs via .then() on the context promise, which resolves before any API call
 * since API methods also await the same promise (and .then() is registered first).
 */
(auth.$context as Promise<any>).then((ctx: any) => {
  const originalFindUserByEmail = ctx.internalAdapter.findUserByEmail.bind(
    ctx.internalAdapter,
  );

  ctx.internalAdapter.findUserByEmail = async (
    email: string,
    options?: { includeAccounts?: boolean },
  ) => {
    const tenantId = tenantIdStore.getStore();
    if (!tenantId) return originalFindUserByEmail(email, options);

    const user = await db.query.users.findFirst({
      where: and(
        eq(schema.users.email, email.toLowerCase()),
        eq(schema.users.tenantId, tenantId),
      ),
    });
    if (!user) return null;

    let userAccounts: (typeof schema.accounts.$inferSelect)[] = [];
    if (options?.includeAccounts) {
      userAccounts = await db.query.accounts.findMany({
        where: eq(schema.accounts.userId, user.id),
      });
    }

    return { user, accounts: userAccounts };
  };
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
