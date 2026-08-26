import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from './index.ts';

/**
 * Route handlers for the auth catch-all route.
 *
 * Exported here so `apps/web` never imports `better-auth` directly — the app depends
 * on our contract, not on the vendor.
 *
 * The handler is resolved per request, not at module load. Touching `auth()` at import
 * time would read the environment during `next build`, which must succeed on a clean
 * checkout with no secrets configured.
 */
export const { GET, POST } = toNextJsHandler((request: Request) => auth().handler(request));
