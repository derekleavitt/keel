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

/**
 * Replace files that referenced the testbed with platform-only versions.
 *
 * These are shipped as real files under `scripts/eject-templates/` rather than generated as
 * strings, so they are reviewable in a diff and type-checked by the repository they belong to
 * — a template emitted from a string literal is the one file nothing ever checks.
 *
 * The realtime route's `authorize()` deliberately returns nothing after this: which channels
 * exist is a question about your resources, and refusing everything is the safe answer while
 * the answer is unknown.
 */
const templates = path.join(root, 'scripts', 'eject-templates');
for (const relative of [
  'app/dashboard/page.tsx',
  'app/api/jobs/run/route.ts',
  'app/api/realtime/route.ts',
]) {
  const from = path.join(templates, relative);
  const to = path.join(root, 'apps/web', relative);
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
}
git(['rm', '-r', '-q', '--ignore-unmatch', 'scripts/eject-templates']);

/**
 * Strip links to routes that no longer exist.
 *
 * `typedRoutes` turns every one of these into a compile error rather than a 404 at runtime,
 * which is why this is a fixed list and not a guess — the build says immediately if one was
 * missed.
 */
function dropLinkBlocks(relative, hrefs) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!hrefs.some((href) => line.includes(`href="${href}"`))) {
      kept.push(line);
      continue;
    }
    // A self-closing `<Link … />` is one element; an open tag runs to its `</Link>` or `</a>`.
    if (!/\/>\s*$/.test(line)) {
      while (index < lines.length && !/<\/(Link|a)>/.test(lines[index] ?? '')) index += 1;
    }
    // Drop the opening line of a multi-line element too.
    while (kept.length > 0 && /<(Link|a)\s*$/.test(kept.at(-1) ?? '')) kept.pop();
  }
  fs.writeFileSync(file, kept.join('\n'));
}

dropLinkBlocks('apps/web/app/admin/layout.tsx', ['/lists']);
dropLinkBlocks('apps/web/app/organizations/page.tsx', ['/lists']);

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
console.log('  1. pnpm install');
console.log('  2. pnpm db:reset && pnpm db:migrate   # the todo tables are gone');
console.log('  3. pnpm verify\n');
console.log('The gate should be green. What is left is authentication, organizations and');
console.log('scoping, billing and plan limits, the job queue, email, storage, audit logging,');
console.log('rate limiting, realtime, search, the admin surface — and no application.\n');
console.log('Implement authorize() in app/api/realtime/route.ts when you have resources to');
console.log('subscribe to; it refuses everything until then, which is the safe default.\n');
console.log('Copy examples/notes for the shape of a feature package.\n');
