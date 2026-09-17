# Testbed

A todo application, built on Keel, in the same repository and behind the same gate.

**This is not a demo.** It is the mechanism by which Keel gets built.

## Why it lives here

Keel's job is to make agents effective on a large codebase. There is no way to know
whether it does that except by building a real application on it and watching where
agents struggle. So the testbed is not a periodic experiment — it is the continuous
driver.

The loop is one loop:

```
pick the next testbed feature
        ↓
try to build it on Keel
        ↓
where Keel makes it hard  ──→  that friction becomes a Keel task
        ↓                              ↓
   feature lands                  fix Keel, record a lesson,
        ↓                          build the mechanism
        └──────────────┬───────────────┘
                       ↓
              next testbed feature
```

Keel therefore only ever grows what the application actually demanded. Nothing is built
because a design document predicted it would be needed.

## Why it is in the workspace

`pnpm verify` covers it. **Breaking the testbed turns Keel's gate red**, which is the
point — a starter whose own application no longer builds is broken, whatever its unit
tests say.

## Deleting it

`testbed/`, `apps/testbed` and the `testbed/*` line in `pnpm-workspace.yaml`. Nothing in
`apps/web` or `packages/*` depends on it.

Requirements: [PRD.md](./PRD.md).
