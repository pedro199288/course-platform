import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stores the current tenant ID for the duration of a request.
 * Set by tenant middleware, read by the auth adapter to scope user lookups.
 */
export const tenantIdStore = new AsyncLocalStorage<string | null>();
