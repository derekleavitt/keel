/**
 * What each plan allows.
 *
 * Data, in one place, rather than conditionals spread through the code. Two properties fall
 * out of that: a limit check is a lookup rather than a branch, and adding a plan is an entry
 * here rather than an audit of every call site.
 *
 * `null` means unlimited, and is deliberately not a very large number. `Infinity` does not
 * survive JSON, and a sentinel like 999_999 eventually shows a customer "999,999 lists
 * remaining" — which is how you learn it was a sentinel.
 */
export const PLANS = {
  free: {
    label: 'Free',
    /*
     * Three, not one.
     *
     * A one-seat free plan makes collaboration a paid feature — which is a legitimate way to
     * sell software and the wrong default for a template. It also means every test of
     * sharing, organizations or anything multi-user has to set up billing first, coupling
     * unrelated features to it. Introducing that limit broke every sharing test at once,
     * which was the suite correctly reporting a product decision made by accident.
     *
     * Small enough that the limit is still demonstrable — a fourth member is refused — and
     * large enough that the feature it governs can be used without one.
     */
    seats: 3,
    lists: 3,
    storageBytes: 10 * 1024 * 1024,
    /** API requests per minute. Part of the plan, so it lives with the other allowances. */
    requestsPerMinute: 60,
  },
  team: {
    label: 'Team',
    seats: 10,
    lists: 100,
    storageBytes: 1024 * 1024 * 1024,
    requestsPerMinute: 600,
  },
  business: {
    label: 'Business',
    seats: null,
    lists: null,
    storageBytes: 50 * 1024 * 1024 * 1024,
    requestsPerMinute: 6_000,
  },
} as const;

export type PlanName = keyof typeof PLANS;
export type LimitName = 'seats' | 'lists' | 'storageBytes';

/** Requests per minute allowed on the public API for a plan. */
export function requestsPerMinuteFor(plan: PlanName): number {
  return PLANS[plan].requestsPerMinute;
}

export const PLAN_NAMES = Object.keys(PLANS) as PlanName[];

export function limitFor(plan: PlanName, limit: LimitName): number | null {
  return PLANS[plan][limit];
}

/**
 * Whether a subscription's status still entitles the tenant to its plan.
 *
 * `past_due` deliberately still does. Cutting a customer off the moment a card expires
 * loses their data access over a billing detail they can usually fix in a minute, and the
 * provider is already retrying the charge. `canceled` is the state that drops entitlements
 * — and it drops them to `free` rather than to nothing, so a former customer can still read
 * and export what they wrote.
 */
export function effectivePlan(plan: PlanName, status: string): PlanName {
  return status === 'canceled' ? 'free' : plan;
}
