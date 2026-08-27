#!/usr/bin/env node
/**
 * Enforce that lessons get enforced.
 *
 * A mistake recorded as prose is a liability: it costs context on every turn and gets
 * missed anyway. Six agents read a self-contradicting comment in schema.ts and none of
 * them fixed it, because nothing made them.
 *
 * So every lesson names the mechanism that prevents its recurrence, and this check fails
 * when that mechanism does not exist. Promotion ladder, strongest first:
 *
 *   test    the mistake cannot recur silently
 *   lint    the mistake cannot be expressed
 *   hook    blocked at write time
 *   gate    caught before the turn ends
 *   example a worked reference agents pattern-match against
 *   rule    a path-scoped rule, loaded when relevant
 *   doc     a line in CLAUDE.md — always loaded, easily lost
 *   nothing not yet enforced. Allowed only inside the grace window.
 *
 * `doc` and `nothing` are under-enforced. They are permitted for GRACE_DAYS so a lesson
 * can be captured immediately and promoted deliberately — not forgotten.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.orchestration', 'lessons');
const GRACE_DAYS = 14;

const STRENGTH = {
  test: 1,
  lint: 2,
  hook: 3,
  gate: 4,
  example: 5,
  rule: 6,
  doc: 7,
  nothing: 8,
};
const UNDER_ENFORCED = new Set(['doc', 'nothing']);

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => /^L-\d+\.md$/.test(f));
} catch {
  console.log('lessons: no ledger yet — nothing to validate');
  process.exit(0);
}

const errors = [];
const warnings = [];
const now = Date.now();

for (const file of files.sort()) {
  const full = path.join(dir, file);
  const text = fs.readFileSync(full, 'utf8');
  const fm = frontmatter(text);
  const id = fm.id ?? file.replace(/\.md$/, '');

  if (!fm.enforced_by) {
    errors.push(`${id}: missing 'enforced_by'. Name the mechanism, or 'nothing'.`);
    continue;
  }
  if (!(fm.enforced_by in STRENGTH)) {
    errors.push(
      `${id}: unknown enforced_by '${fm.enforced_by}'. Use one of ${Object.keys(STRENGTH).join(', ')}.`,
    );
    continue;
  }

  // The named enforcement must actually exist on disk.
  if (fm.enforced_by !== 'nothing') {
    if (!fm.enforcement_ref) {
      errors.push(`${id}: enforced_by '${fm.enforced_by}' but no enforcement_ref.`);
    } else {
      const target = fm.enforcement_ref.split(':')[0];
      if (!fs.existsSync(path.join(root, target))) {
        errors.push(
          `${id}: enforcement_ref '${target}' does not exist. ` +
            'A lesson claiming enforcement that is absent is worse than one claiming none.',
        );
      }
    }
  }

  if (UNDER_ENFORCED.has(fm.enforced_by)) {
    const observed = Date.parse(fm.observed ?? '');
    const ageDays = Number.isNaN(observed) ? Infinity : (now - observed) / 86_400_000;
    if (ageDays > GRACE_DAYS) {
      errors.push(
        `${id}: still enforced only by '${fm.enforced_by}' after ${Math.round(ageDays)} days. ` +
          `Promote it to a test, lint rule, hook or gate check — or explain in the lesson why it cannot be.`,
      );
    } else {
      warnings.push(
        `${id}: enforced only by '${fm.enforced_by}' — promote within ${Math.round(GRACE_DAYS - ageDays)} days.`,
      );
    }
  }
}

const byStrength = files.length ? `${files.length} lesson(s)` : 'none';

if (errors.length) {
  console.error(`lessons: ${errors.length} problem(s) in ${byStrength}\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(
    '\nA lesson exists to stop a mistake recurring. If it is not enforced, it is a note.',
  );
  process.exit(1);
}

for (const w of warnings) console.log(`  ! ${w}`);
console.log(`lessons: ${byStrength}, all enforced`);
