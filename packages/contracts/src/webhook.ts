import { z } from 'zod';

/**
 * The events a receiver can subscribe to.
 *
 * A closed list, not free text. A typo in a subscription is otherwise silent — the
 * endpoint is created, matches nothing, and delivers nothing, with no error anywhere and
 * nothing to distinguish it from a receiver that is simply idle.
 */
export const WEBHOOK_EVENTS = [
  'todo.created',
  'todo.completed',
  'todo.reopened',
  'todo.deleted',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const createWebhookEndpointSchema = z.object({
  url: z.string().trim().min(1, 'Enter a URL'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1, 'Choose at least one event')
    // Two subscriptions to the same event would deliver it twice.
    .refine((events) => new Set(events).size === events.length, 'Duplicate events'),
});

export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;
