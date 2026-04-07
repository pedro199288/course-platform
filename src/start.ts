import { createStart } from "@tanstack/react-start";
import { tenantMiddleware } from "#/middleware/tenant.ts";

export const startInstance = createStart(() => ({
  requestMiddleware: [tenantMiddleware],
}));
