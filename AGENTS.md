# Agent instructions

This repository's agent guidance lives in [CLAUDE.md](./CLAUDE.md). It applies to any
coding agent, not just Claude Code.

The short version:

- `pnpm verify` is the definition of done. Never work around it.
- Nothing may throw at import time — environment, database and auth are lazy.
- Respect package boundaries: `apps/web` depends on `@keel/*`, never on vendors directly.
- Full conventions and layout: [CLAUDE.md](./CLAUDE.md)
- Architecture and roadmap: [docs/architecture.md](./docs/architecture.md)
