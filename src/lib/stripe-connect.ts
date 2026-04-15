import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { tenants, users } from "#/db/schema/index.ts";
import { auth } from "./auth.ts";
import { getStripe } from "./stripe.ts";
import { BASE_URL } from "./config.ts";
import { tenantIdStore } from "./tenant-context.ts";

/**
 * Creates a Stripe Connect Standard account for the tenant and returns
 * an Account Link URL to redirect the user into Stripe's onboarding.
 */
export const createStripeConnectLinkFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return { error: "Not authenticated.", url: null };
  }

  const tenantId = tenantIdStore.getStore()!;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });

  if (!user || user.role !== "tenant_owner") {
    return { error: "Only school owners can connect Stripe.", url: null };
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) {
    return { error: "School not found.", url: null };
  }

  const stripe = getStripe();
  let accountId = tenant.stripeConnectAccountId;

  // Create a new Stripe Connect account if one doesn't exist yet
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "standard",
      email: session.user.email,
      metadata: { tenantId: tenant.id },
    });
    accountId = account.id;

    await db
      .update(tenants)
      .set({ stripeConnectAccountId: accountId })
      .where(eq(tenants.id, tenant.id));
  }

  const baseUrl = BASE_URL;

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/admin/onboarding?stripe=refresh`,
    return_url: `${baseUrl}/admin/onboarding?stripe=return`,
    type: "account_onboarding",
  });

  return { error: null, url: accountLink.url };
});

/**
 * Fetches the current Stripe Connect status for the tenant.
 */
export const getStripeConnectStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return { connected: false, detailsSubmitted: false, chargesEnabled: false, accountId: null };
  }

  const tenantId = tenantIdStore.getStore()!;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { role: true },
  });

  if (!user || user.role !== "tenant_owner") {
    return { connected: false, detailsSubmitted: false, chargesEnabled: false, accountId: null };
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { stripeConnectAccountId: true, stripeOnboardingComplete: true },
  });

  if (!tenant?.stripeConnectAccountId) {
    return { connected: false, detailsSubmitted: false, chargesEnabled: false, accountId: null };
  }

  const stripe = getStripe();
  try {
    const account = await stripe.accounts.retrieve(tenant.stripeConnectAccountId);
    const detailsSubmitted = account.details_submitted ?? false;
    const chargesEnabled = account.charges_enabled ?? false;

    // Sync onboarding status if it changed
    if (detailsSubmitted && tenant.stripeOnboardingComplete !== "true") {
      await db
        .update(tenants)
        .set({ stripeOnboardingComplete: "true" })
        .where(eq(tenants.id, tenantId));
    }

    return {
      connected: true,
      detailsSubmitted,
      chargesEnabled,
      accountId: tenant.stripeConnectAccountId,
    };
  } catch {
    return {
      connected: false,
      detailsSubmitted: false,
      chargesEnabled: false,
      accountId: tenant.stripeConnectAccountId,
    };
  }
});
