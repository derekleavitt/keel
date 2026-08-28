import { requireScope } from '@keel/organizations/scope';
import { readAttachment } from '@keel/testbed-attachments';

export const dynamic = 'force-dynamic';

/**
 * Download an attachment.
 *
 * A route rather than a public URL, because authorization has to run per request. Serving
 * blobs from a guessable path — or a signed URL with a long life — means access outlives
 * the permission that granted it, which is exactly what revoking a share is supposed to
 * prevent.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const scope = await requireScope();
  const { id } = await params;

  const file = await readAttachment(scope, id);
  // Indistinguishable from "does not exist" on purpose: a 403 would confirm the id is real.
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      'content-type': file.contentType,
      // `attachment` rather than `inline`: a browser rendering an uploaded file in the
      // app's own origin is how a stored file becomes stored XSS.
      'content-disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
      'content-length': String(file.data.byteLength),
      'cache-control': 'private, no-store',
    },
  });
}
