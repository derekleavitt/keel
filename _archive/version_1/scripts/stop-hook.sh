#!/usr/bin/env bash
# Claude Code Stop hook.
#
# Exit 2 blocks the agent from finishing the turn and feeds stderr back to it as
# feedback, so a red gate becomes something the agent must fix rather than a warning
# it can narrate past. Any other failure mode stays non-blocking on purpose — a
# broken hook should not wedge the session.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 0

if ! command -v pnpm >/dev/null 2>&1; then
  exit 0
fi

if output=$(pnpm verify 2>&1); then
  exit 0
fi

printf '%s\n' "$output" >&2
printf '\nThe verify gate is red. Fix the cause above before finishing.\n' >&2
printf 'Do not weaken a check or delete a failing test to get past it.\n' >&2
printf 'If it cannot be fixed in this turn, say so explicitly and explain why.\n' >&2
exit 2
