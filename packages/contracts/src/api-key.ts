import { z } from 'zod';

/**
 * A key's name is the only thing a human supplies. Everything else about a key is
 * generated, which is what makes the creation form one field.
 */
export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name')
    .max(60, 'Keep the name under 60 characters'),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
