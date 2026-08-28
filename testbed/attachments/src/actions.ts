'use server';

import { revalidatePath } from '@keel/runtime';
import { requireScope } from '@keel/testbed-orgs/scope';
import { deleteAttachment, type UploadFailure, uploadAttachment } from './queries.ts';

const MESSAGES: Record<UploadFailure, string> = {
  'not-found': 'That todo is not yours to change',
  'too-large': 'That file is larger than 10MB',
  'unsupported-type': 'That file type is not allowed',
  empty: 'That file is empty',
  'invalid-name': 'That filename is not usable',
};

/**
 * Upload, from a multipart form.
 *
 * The bytes are read here and measured here. The `size` a browser reports and the `accept`
 * attribute on the input are conveniences for honest users; every limit is re-checked
 * against what actually arrived.
 */
export async function uploadAttachmentAction(form: unknown) {
  const scope = await requireScope();
  if (!(form instanceof FormData)) return { ok: false as const, error: 'Invalid upload' };

  const todoId = form.get('todoId');
  const file = form.get('file');
  if (typeof todoId !== 'string' || !(file instanceof File)) {
    return { ok: false as const, error: 'Choose a file' };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const result = await uploadAttachment(scope, {
    todoId,
    filename: file.name,
    contentType: file.type,
    data,
  });

  if (!result.ok) return { ok: false as const, error: MESSAGES[result.reason] };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}

export async function deleteAttachmentAction(id: unknown) {
  const scope = await requireScope();
  if (typeof id !== 'string') return { ok: false as const, error: 'Invalid attachment' };

  const removed = await deleteAttachment(scope, id);
  if (!removed) return { ok: false as const, error: 'Not yours to delete' };
  revalidatePath('/lists', 'layout');
  return { ok: true as const };
}
