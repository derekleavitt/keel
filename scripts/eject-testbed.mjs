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
 * Repoint links at routes that still exist, rather than deleting them.
 *
 * Deleting a `<Link>` leaves its import unused, which is another error to chase; rewriting the
 * target keeps every file valid and the navigation sensible. `/dashboard` is where a signed-in
 * user lands, so it is the honest destination for a "back" link once `/lists` is gone.
 *
 * `typedRoutes` is what makes this safe to do mechanically: a link to a route that does not
 * exist is a compile error, so the build says immediately if one was missed rather than
 * leaving a 404 to be found by a user.
 */
function repointLinks(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return;

  const rewritten = fs
    .readFileSync(file, 'utf8')
    .replaceAll('href="/lists"', 'href="/dashboard"')
    .replaceAll('href="/agenda"', 'href="/dashboard"')
    .replaceAll('href="/search"', 'href="/dashboard"')
    .replaceAll('Back to lists', 'Back to dashboard')
    .replaceAll('All lists', 'Dashboard')
    .replaceAll('Leave staff area', 'Leave staff area');
  fs.writeFileSync(file, rewritten);
}

for (const relative of [
  'app/admin/layout.tsx',
  'app/organizations/page.tsx',
  'app/settings/api-keys/page.tsx',
  'app/settings/webhooks/page.tsx',
  'app/settings/billing/page.tsx',
]) {
  repointLinks(path.join('apps/web', relative));
}

/**
 * The billing page counted lists, which no longer exist.
 *
 * Billing deliberately cannot measure anything itself — the caller supplies usage, which is
 * what keeps `@keel/billing` from depending on whichever features have limits (see
 * `.orchestration/lessons/L-044.md`). So this is a one-line change at the call site: pass
 * zero, and add your own resource when you have one.
 */
const billingPage = path.join(root, 'apps/web/app/settings/billing/page.tsx');
if (fs.existsSync(billingPage)) {
  const rewritten = fs
    .readFileSync(billingPage, 'utf8')
    .replace(/import \{ listLists \} from '@keel\/testbed-lists';\n/, '')
    .replace(
      /const \[lists, members\] = await Promise\.all\(\[listLists\(scope\), listMembers\(scope\)\]\);/,
      'const members = await listMembers(scope);',
    )
    .replace(
      /lists: lists\.length,/,
      '// No countable resources yet — supply your own here as you add them.\n    lists: 0,',
    );
  fs.writeFileSync(billingPage, rewritten);
}

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
