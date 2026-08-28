import { z } from 'zod';

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

export const createRecurrenceSchema = z
  .object({
    listId: z.string().min(1),
    title: z.string().trim().min(1, 'Give it a title').max(200),
    notes: z.string().max(2000).nullish(),
    priority: z.enum(['none', 'low', 'medium', 'high']).optional(),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.number().int().min(1, 'Repeat at least every 1').max(365),
    byWeekday: z.array(z.number().int().min(0).max(6)).nullish(),
    startDate: isoDate,
    until: isoDate.nullish(),
    /**
     * Required, not defaulted.
     *
     * A default would be the *server's* zone, which is nobody's — and the failure is
     * silent, producing todos on the wrong day for anyone not sitting beside the server.
     * The browser knows the answer (`Intl.DateTimeFormat().resolvedOptions().timeZone`),
     * so asking for it costs nothing and removes a whole class of bug.
     */
    timeZone: z.string().min(1, 'A time zone is required'),
  })
  .refine((value) => !value.until || value.until >= value.startDate, {
    message: 'The end date is before the start date',
    path: ['until'],
  });

export type CreateRecurrenceInput = z.infer<typeof createRecurrenceSchema>;
