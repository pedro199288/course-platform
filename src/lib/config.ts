import "@tanstack/react-start/server-only";

export const PORT = process.env.PORT || "4500";
export const BASE_URL = process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`;
export const PLATFORM_DOMAIN = new URL(BASE_URL).host;
