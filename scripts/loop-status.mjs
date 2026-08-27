#!/usr/bin/env node
/**
 * Reconstruct loop state from the repository and write the two handoff documents.
 *
 * State is DERIVED, never maintained by hand. The loop can die at any instant — credit
 * exhaustion, a killed terminal, a crash — and hand-written status would be stale from
 * that moment on. Task frontmatter, lock directories and git history are the ground
 * truth, and they survive any kind of stop.
 *
 * Run it freely: read-only apart from the two files it writes.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const orch = path.join(root, '.orchestration');
const STALE_LOCK_MINUTES = 45;

/** Minimal frontmatter reader — avoids a dependency for four scalar fields. */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    out[key] = raw.startsWith('[')
      ? raw
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : raw.trim();
  }
  return out;
}

function git(cmd, fallback = '') {
  try {
    return execSync(`git ${cmd}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ---------- gather ----------

const tasks = readDir(path.join(orch, 'tasks'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const text = fs.readFileSync(path.join(orch, 'tasks', f), 'utf8');
    const fm = frontmatter(text);
    const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? fm.id ?? f;
    const boxes = text.match(/^- \[[ xX]\]/gm) ?? [];
    return {
      id: fm.id ?? f.replace(/\.md$/, ''),
      title,
      status: fm.status ?? 'open',
      phase: fm.phase ?? '?',
      territory: fm.territory ?? '-',
      dependsOn: Array.isArray(fm.depends_on) ? fm.depends_on : [],
      acceptance: {
        checked: boxes.filter((b) => /\[[xX]\]/.test(b)).length,
        total: boxes.length,
      },
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));

const locks = readDir(path.join(orch, 'locks'))
  .filter((n) => !n.startsWith('.'))
  .map((name) => {
    const ageMin = (Date.now() - fs.statSync(path.join(orch, 'locks', name)).mtimeMs) / 60000;
    return { name, ageMin, stale: ageMin > STALE_LOCK_MINUTES };
  });

const blocked = readDir(path.join(orch, 'blocked')).filter((f) => f.endsWith('.md'));
const unblocked = tasks.filter((t) => t.status === 'open' && t.dependsOn.every((d) => done.has(d)));
const inFlight = tasks.filter((t) => t.status === 'claimed');

const dirty = git('status --porcelain');
const branch = git('rev-parse --abbrev-ref HEAD', 'unknown');
const lastCommit = git('log -1 --format=%h|%s|%cr').split('|');
const unpushed = git('log --oneline @{u}..HEAD').split('\n').filter(Boolean).length;

const phases = [...new Set(tasks.map((t) => t.phase))].sort();
const phaseRows = phases.map((phase) => {
  const inPhase = tasks.filter((t) => t.phase === phase);
  return {
    phase,
    done: inPhase.filter((t) => t.status === 'done').length,
    total: inPhase.length,
  };
});

// A stop is clean only when nothing is half-finished on disk.
const clean = !dirty && inFlight.length === 0 && locks.length === 0;
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
const next = inFlight[0] ?? unblocked[0];

// ---------- status.md ----------

const sections = [];
if (inFlight.length) {
  sections.push(
    `## In flight\n\n${inFlight
      .map(
        (t) =>
          `- **${t.id}** ${t.title} — acceptance ${t.acceptance.checked}/${t.acceptance.total}`,
      )
      .join('\n')}\n`,
  );
}
if (locks.length) {
  sections.push(
    `## Locks\n\n${locks
      .map(
        (l) =>
          `- \`${l.name}\` held ${Math.round(l.ageMin)}m${l.stale ? ' — **STALE, safe to reclaim**' : ''}`,
      )
      .join('\n')}\n`,
  );
}
if (blocked.length) {
  sections.push(
    `## Blocked — needs a human\n\n${blocked
      .map((b) => `- \`.orchestration/blocked/${b}\``)
      .join('\n')}\n`,
  );
}

fs.writeFileSync(
  path.join(orch, 'status.md'),
  `# Loop status

_Derived from repository state at ${stamp} UTC. Regenerate with \`pnpm loop:status\`._

## Phases

| Phase | Done | Total |
|---|---|---|
${phaseRows.map((r) => `| ${r.phase} | ${r.done} | ${r.total} |`).join('\n')}

**Overall:** ${done.size}/${tasks.length} tasks complete.

## Right now

- **Stop state:** ${clean ? 'CLEAN — safe to walk away' : 'MID-TASK — read RESUME.md before continuing'}
- **Branch:** \`${branch}\`${unpushed > 0 ? ` — **${unpushed} unpushed commit(s)**` : ''}
- **Working tree:** ${dirty ? `**dirty** (${dirty.split('\n').length} file(s))` : 'clean'}
- **Last commit:** \`${lastCommit[0] ?? '-'}\` ${lastCommit[1] ?? ''} _(${lastCommit[2] ?? '-'})_

${sections.join('\n')}## Next unblocked

${
  unblocked.length
    ? unblocked
        .slice(0, 5)
        .map((t) => `- **${t.id}** ${t.title}`)
        .join('\n')
    : '_None — every open task is waiting on a dependency._'
}
`,
);

// ---------- RESUME.md ----------

const recovery = [];
if (dirty) {
  recovery.push(
    `There are uncommitted changes:

\`\`\`
${dirty.split('\n').slice(0, 25).join('\n')}
\`\`\`

Run \`pnpm verify\`. If green, commit them. If red, decide whether to finish the work or run \`git checkout -- .\` and restart the task cleanly.`,
  );
}
if (inFlight.length) {
  recovery.push(
    `**${inFlight[0].id}** is marked \`claimed\` with acceptance ${inFlight[0].acceptance.checked}/${inFlight[0].acceptance.total} met. Open \`.orchestration/tasks/${inFlight[0].id}.md\` and work through the unchecked items.`,
  );
}
if (locks.some((l) => l.stale)) {
  recovery.push(
    `Stale lock(s) held over ${STALE_LOCK_MINUTES}m: ${locks
      .filter((l) => l.stale)
      .map((l) => `\`${l.name}\``)
      .join(', ')}. The holder is gone — \`rmdir\` them.`,
  );
}
if (unpushed > 0) {
  recovery.push(
    `**${unpushed} commit(s) are unpushed.** Push before continuing so the work is not only on this machine.`,
  );
}

const nextBlock = next
  ? `**${next.id} — ${next.title}**

\`\`\`bash
cat .orchestration/tasks/${next.id}.md
\`\`\`

Then follow \`.orchestration/loop-protocol.md\` from step 2 (Claim). The task's
**Acceptance** list is the definition of done — never edit it to match what was built.`
  : blocked.length
    ? 'Every open task is blocked. Read `.orchestration/blocked/` and resolve, or report to the human.'
    : `Nothing open. All ${tasks.length} tasks are done — verify the final state and report.`;

fs.writeFileSync(
  path.join(orch, 'RESUME.md'),
  `# Resume here

_Written for someone with **no memory of previous sessions**. Everything needed to
continue is in this file or linked from it. Regenerate with \`pnpm loop:status\`._

Generated ${stamp} UTC.

---

## 1. What this project is

Keel — an agent-native Next.js starter with a spec-driven build harness. Phase 0 is
shipped and green. Phases 1-6 are being built by a loop.

- Why it is shaped this way: \`docs/architecture.md\`
- How one loop iteration works: \`.orchestration/loop-protocol.md\`
- Conventions you must follow: \`CLAUDE.md\`

## 2. State of the working tree

${
  clean
    ? '**CLEAN.** The last iteration finished properly. Nothing is half-done — start the next task below.'
    : `**MID-TASK.** A previous session stopped before finishing. Handle these first:

${recovery.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}`
}

## 3. Do this next

${nextBlock}

## 4. Before you stop

Credit and session limits end a run without warning, so **leave the repo resumable at all
times**:

- Commit working increments as you go. Uncommitted work is ambiguous to the next session.
- Run \`pnpm loop:status\` after every step — it rewrites this file from actual state.
- Never leave the gate red at a stopping point. Red plus no context is the worst handoff.
- If you stop mid-task, write why in \`.orchestration/journal/\`.

## 5. Progress

${phaseRows.map((r) => `- Phase ${r.phase}: ${r.done}/${r.total}`).join('\n')}

Full dashboard: \`.orchestration/status.md\`
`,
);

console.log(
  `loop:status — ${done.size}/${tasks.length} done · ${clean ? 'clean' : 'MID-TASK'} · next: ${next?.id ?? 'none'}`,
);
if (blocked.length) console.log(`  ${blocked.length} blocked task(s) need a human`);
if (locks.some((l) => l.stale)) console.log('  stale lock(s) present');
if (process.env.KEEL_LOOP_STRICT === '1' && !clean) process.exitCode = 1;
