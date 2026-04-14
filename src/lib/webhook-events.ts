export const WEBHOOK_EVENTS = [
  "enrollment.created",
  "enrollment.revoked",
  "payment.completed",
  "payment.refunded",
  "course.completed",
  "subscription.created",
  "subscription.canceled",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
