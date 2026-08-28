# Platform readiness

**The definition of done.** Keel is finished when a competent team could start *any* web
platform on it and not immediately hit a wall.

Not "the todo app works." Not "six phases built." This checklist is the termination
condition, and the testbed exists to force every line of it.

## How a capability gets ticked

A row is done when **all four** hold:

1. The testbed genuinely uses it — not a demo, a feature that would break if it broke.
2. There is a **worked example** in the repo an agent can copy. Rules describe; examples
   demonstrate, and three agents inventing three answers is the failure this prevents.
3. It is covered by `pnpm verify`, at the strongest level available.
4. Someone can swap the vendor without touching feature code — the boundary is real.

A capability with no example is not done, however well it works. That is the single most
repeated finding in this repo's history.

---

## Foundations

| Capability | State | Proven by |
|---|---|---|
| Monorepo with enforced boundaries | done | package resolution; agents cannot suppress it |
| Verify gate as definition of done | done | fault-injected: all five steps fail correctly |
| Local development database | done | `pnpm db:up`, K-001 |
| Schema and migrations | done | integrator-time generation, split schema files |
| Authentication | done | real sign-up e2e against a real database |
| Query-layer testing | done | PGlite, cross-user isolation |
| Crash-safe resume | done | derived state, cold-clone verified |
| Learning from mistakes | done | lesson ledger, enforcement checked by the gate |

## Authorization and tenancy

| Capability | Driver | Why any platform needs it |
|---|---|---|
| Sharing and per-resource permissions | T-10 | Ownership alone stops working the moment two people touch one thing |
| Organizations / multi-tenancy | T-11 | Nearly every platform is multi-tenant, and retrofitting it is brutal |
| Roles and an admin surface | T-18 · **done** | Someone always needs to see across tenants. Platform staff is a separate axis from membership — see [[L-037]] |
| Audit log | T-14 · **done** | Required the first time a customer asks "who changed this". Recorded in the query layer, so every entry point is covered — see [[L-028]] |

## Asynchronous work

| Capability | Driver | Why any platform needs it |
|---|---|---|
| Background jobs / queue | T-12 · **done at T-16** | Anything slow must leave the request path. Marked done at T-12 while its claim query had never once run against the production driver; T-16 was the first HTTP drain and it threw twice. See [[L-033]] |
| Scheduled / recurring work | T-17 · **done** | Reminders, digests, cleanup, billing runs. Generic date engine in `@keel/scheduling`; idempotent by constraint — see [[L-035]] |
| Transactional email | T-12 | Password resets alone make this mandatory |

## Data and content

| Capability | Driver | Why any platform needs it |
|---|---|---|
| File upload and storage | T-13 | Avatars, attachments, imports, exports |
| Full-text search | T-19 · **done** | Every list view outgrows a `LIKE` query. Per-feature sources merged by a composition layer; index is a generated column, so it cannot lag |
| Real-time updates | T-20 · **done** | Two tabs disagreeing is a bug users report. SSE over a Postgres change log; re-authorized while open — see [[L-042]] |

## External surface

| Capability | Driver | Why any platform needs it |
|---|---|---|
| Public API with keys | T-15 · **done** | Session auth does not work for machines. `/api/v1`, split-token keys, revocable — see [[L-031]] |
| Outbound webhooks | T-16 · **done** | Integration is table stakes. Two-stage dispatch, signed, replayable, SSRF-guarded |
| Rate limiting | T-22 | The first abusive client arrives sooner than expected |
| Payments and subscriptions | T-21 | Any commercial platform, and the hardest to bolt on late |

## What "done" has to mean

T-12 marked the job queue done with 13 green unit tests, a dead-letter path and an admin
page. Four tasks later, the first time anything drained it over HTTP, its central query
threw twice for two unrelated reasons — because PGlite and the production driver disagree
about parameter serialisation and result shape, and no test had ever crossed that boundary.

Nothing in the gate was wrong. The coverage was real. The capability had simply never run.

So a row here is not done because its tests pass. It is done when the testbed genuinely
uses it **through the running application**, which is the only thing that exercises the
wire format, the framework's caching, and the driver that actually ships. See
`.orchestration/lessons/L-033.md`.

## Operating it

| Capability | Driver | Why any platform needs it |
|---|---|---|
| Structured logging and error reporting | T-12 | A background job failing silently is the classic outage |
| Observability of the gate itself | built | `pnpm loop:status` |
| Deployment story | T-21 | Vercel-first, Docker-ready, documented and exercised |

---

## The threshold that matters most

Territories, `graph_disjoint`, impact analysis and the doc-staleness gate exist for
codebases **that do not fit in one context window**. A nine-feature todo app does fit,
which is why it would never demand them.

The testbed is therefore grown deliberately past that threshold. By T-11 (organizations)
there are enough feature packages, cross-cutting concerns and shared contracts that an
agent genuinely cannot hold the codebase in its head — and only then does the machinery
Keel was designed around become testable rather than theoretical.

If a capability above is reached and the machinery still is not demanded, **that is a
result**: the prediction was wrong and the corresponding `P-*` task should be deleted
rather than built.
