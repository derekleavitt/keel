export { GET, POST } from '@keel/auth/next';

// Auth is inherently per-request; never let Next try to prerender it.
export const dynamic = 'force-dynamic';
