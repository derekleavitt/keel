/**
 * The shape of a contract schema, without naming the library that produces one.
 *
 * `apps/web` validates request bodies but must not take a direct dependency on Zod to do
 * it — the app composes packages, and a vendor reached for directly there is the boundary
 * erosion `.claude/rules/web.md` exists to prevent. Every schema in this package satisfies
 * this interface structurally, so a route can accept one without importing Zod at all.
 *
 * Swapping the validation library would change this file and nothing in the app.
 */
export interface Parser<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
}

/** The type a `Parser` yields, for callers that need to name it. */
export type Parsed<P> = P extends Parser<infer T> ? T : never;
