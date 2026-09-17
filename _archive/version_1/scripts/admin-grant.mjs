#!/usr/bin/env node
/**
 * Grant or revoke platform staff access.
 *
 * Deliberately a script and not a page. The first administrator has to come from somewhere,
 * and every in-app path to creating one is a privilege-escalation route the moment any
 * other bug lets a request reach it. Running this requires shell access to the deployment,
 * which is the level of access the capability is worth.
 *
 *   pnpm admin:grant you@example.com "on-call rotation"
 *   pnpm admin:grant --revoke you@example.com
 *   pnpm admin:grant --list
 */
import process from 'node:process';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const list = args.includes('--list');
const positional = args.filter((arg) => !arg.startsWith('--'));

const { db } = await import('@keel/db');
const { grantPlatformAdmin, listPlatformAdmins, revokePlatformAdmin } = await import(
  '@keel/auth/platform'
);

const database = db();

if (list) {
  const admins = await listPlatformAdmins(database);
  if (admins.length === 0) console.log('No platform administrators.');
  for (const admin of admins) {
    console.log(`${admin.email}  ${admin.note ?? ''}  (${admin.grantedAt.toISOString()})`);
  }
  process.exit(0);
}

const [email, note] = positional;
if (!email) {
  console.error('usage: pnpm admin:grant <email> [note] | --revoke <email> | --list');
  process.exit(1);
}

if (revoke) {
  const admins = await listPlatformAdmins(database);
  const target = admins.find((admin) => admin.email === email);
  if (!target) {
    console.error(`${email} is not a platform administrator.`);
    process.exit(1);
  }
  await revokePlatformAdmin(target.userId, database);
  console.log(`revoked platform admin from ${email}`);
  process.exit(0);
}

const result = await grantPlatformAdmin(email, { note }, database);
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(`granted platform admin to ${email}`);
process.exit(0);
