#!/usr/bin/env node
/**
 * Remove the todo application, leaving the platform.
 *
 * Keel is developed against a real application — that is how every capability got built and
 * why each one is exercised rather than asserted. But a reference implementation you cannot
 * remove is not a reference implementation; it is your first merge conflict.
 *
 * This deletes the testbed and everything that exists only to serve it, and leaves a repo
 * whose gate still passes: authentication, organizations, the job queue, billing, rate
 * limiting, search, realtime, storage, email, audit, the admin surface, and a signed-in
 * dashboard with nothing on it.
 *
 *   pnpm eject:testbed            # show what would be removed
 *   pnpm eject:testbed --confirm  # do it
 *
 * Irreversible by design — it is `git rm`. Run it on a clean tree so `git checkout .` is the
 * undo, and run `pnpm verify` afterwards, which the script tells you to do rather than doing
 * for you: a script that verifies its own destruction is a script nobody reads the output of.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const confirm = process.argv.includes('--confirm');

/** Everything that exists only because the todo app does. */
const DIRECTORIES = [
  'testbed',
  'apps/web/app/lists',
  'apps/web/app/agenda',
  'apps/web/app/search',
  'apps/web/app/activity',
];

const FILES = [
  // Schema owned by the todo app. The platform tables — auth, organization, job, billing,
  // api_key, audit, webhook, change_log, rate_limit, platform — all stay.
  'packages/db/src/schema/todo.ts',
  'packages/db/src/schema/list.ts',
  'packages/db/src/schema/tag.ts',
  'packages/db/src/schema/attachment.ts',
  'packages/db/src/schema/recurrence.ts',
  // Contracts describing todo-app shapes.
  'packages/contracts/src/todo.ts',
  'packages/contracts/src/list.ts',
  'packages/contracts/src/tag.ts',
  'packages/contracts/src/recurrence.ts',
  // Browser suites for features that are leaving.
  'apps/web/e2e/todos.spec.ts',
  'apps/web/e2e/lists.spec.ts',
  'apps/web/e2e/tags.spec.ts',
  'apps/web/e2e/filters.spec.ts',
  'apps/web/e2e/reorder.spec.ts',
  'apps/web/e2e/sharing.spec.ts',
  'apps/web/e2e/agenda.spec.ts',
  'apps/web/e2e/search.spec.ts',
  'apps/web/e2e/notes.spec.ts',
  'apps/web/e2e/attachments.spec.ts',
  'apps/web/e2e/recurrence.spec.ts',
  'apps/web/e2e/realtime.spec.ts',
  'apps/web/e2e/reminders.spec.ts',
  // API routes serving todo resources.
  'apps/web/app/api/v1/lists',
  'apps/web/app/api/v1/todos',
  'apps/web/app/api/attachments',
];

const exists = (relative) => fs.existsSync(path.join(root, relative));
const targets = [...DIRECTORIES, ...FILES].filter(exists);

if (!confirm) {
  console.log('Would remove:\n');
  for (const target of targets) console.log(`  ${target}`);
  console.log(`\n${targets.length} paths. Re-run with --confirm to do it.`);
  console.log('\nWhat stays: auth, organizations, billing, jobs, email, storage, audit,');
  console.log('rate limiting, realtime, scheduling, search, the admin surface, and the gate.');
  process.exit(0);
}

const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' });

// `git rm -r` rather than `fs.rm`: it stages the deletion, so the change is reviewable as a
// diff and recoverable with `git checkout .` until it is committed.
for (const target of targets) git(['rm', '-r', '-q', '--ignore-unmatch', target]);

/** Drop `@keel/testbed-*` from a package.json's dependency maps. */
function pruneDependencies(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;

  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@keel/testbed-')) {
        delete manifest[field][name];
        changed = true;
      }
    }
  }
  if (changed) fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

pruneDependencies('apps/web/package.json');

/** Remove a line matching `pattern` from a file. */
function dropLines(relative, pattern) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return;
  const kept = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !pattern.test(line));
  fs.writeFileSync(file, kept.join('\n'));
}

// `transpilePackages` entries and the workspace glob for a directory that no longer exists.
dropLines('apps/web/next.config.ts', /'@keel\/testbed-/);
dropLines('pnpm-workspace.yaml', /^\s*-\s*"testbed\/\*"/);

// Schema barrel: both the re-export and the spread into the assembled `schema` object.
dropLines(
  'packages/db/src/schema/index.ts',
  /'\.\/(todo|list|tag|attachment|recurrence)\.ts'|\.\.\.(todo|list|tag|attachment|recurrence)Tables,/,
);
dropLines('packages/contracts/src/index.ts', /'\.\/(todo|list|tag|recurrence)\.ts'/);

console.log('\nRemoved the testbed and its schema, routes, contracts and specs.\n');
console.log('Now, in order:');
console.log('  1. pnpm install            # relink the workspace');
console.log('  2. review apps/web/app     # the dashboard and nav still link to what is gone');
console.log('  3. pnpm db:reset && pnpm db:migrate');
console.log('  4. pnpm verify\n');
console.log('Step 2 is yours on purpose. What the landing page and navigation should say is');
console.log('a decision about your product, and a script guessing at it would be wrong.\n');
