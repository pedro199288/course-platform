import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./auth.ts";

/**
 * Server function to get the current user session.
 * Used by route beforeLoad to check authentication.
 * The tenant middleware has already set the AsyncLocalStorage context,
 * so the auth adapter scopes the user lookup to the current tenant.
 */
export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  return session;
});
