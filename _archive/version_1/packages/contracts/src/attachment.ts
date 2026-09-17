import { z } from 'zod';

/**
 * Upload limits, enforced on the server.
 *
 * The browser's `accept` attribute and any client-side size check are conveniences for
 * honest users. Neither is a control: a request can be made with curl. Everything here is
 * checked again after the bytes arrive.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * An allow-list, not a deny-list.
 *
 * Denying `.exe` and `.sh` is a game you lose — the list of dangerous types is open-ended
 * and grows. Allowing a known set is a game you win, at the cost of occasionally adding
 * one on request.
 */
export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
] as const;

export const attachmentContentTypeSchema = z.enum(ALLOWED_CONTENT_TYPES);

/**
 * A display filename.
 *
 * Stripped of any directory component before it is stored: a browser will happily send
 * `../../evil.txt`, and although the storage key is generated independently, a filename
 * that looks like a path ends up in headers, logs and download prompts.
 */
export const attachmentFilenameSchema = z
  .string()
  .transform((value) => value.split(/[/\\]/).pop() ?? '')
  .pipe(z.string().min(1, 'A filename is required').max(255));

export const uploadAttachmentSchema = z.object({
  todoId: z.string().min(1),
  filename: attachmentFilenameSchema,
  contentType: attachmentContentTypeSchema,
  size: z
    .number()
    .int()
    .positive('The file is empty')
    .max(MAX_ATTACHMENT_BYTES, 'That file is larger than 10MB'),
});

export type UploadAttachment = z.infer<typeof uploadAttachmentSchema>;
