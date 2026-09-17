import { MAX_ATTACHMENT_BYTES } from '@keel/contracts/attachment';
import type { Scope } from '@keel/contracts/ids';
import { orphanedBlob } from '@keel/db/schema';
import { createTestDatabase, seedScope, seedSharedOrganization } from '@keel/db/testing';
import { runJobs } from '@keel/jobs';
import { captureStorage } from '@keel/storage/testing';
import { createList, shareList } from '@keel/testbed-lists';
import { createTodo, deleteTodo } from '@keel/testbed-todos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteAttachment, listAttachments, readAttachment, uploadAttachment } from './queries.ts';
import { attachmentHandlers, scheduleSweep } from './sweeper.ts';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let storage: ReturnType<typeof captureStorage>;
let owner: Scope;
let viewer: Scope;
let stranger: Scope;
let todoId: string;

const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(async () => {
  database = await createTestDatabase();
  storage = captureStorage();

  const a = await seedScope(database, { id: 'owner', email: 'owner@example.test' });
  const b = await seedScope(database, { id: 'viewer', email: 'viewer@example.test' });
  const c = await seedScope(database, { id: 'stranger', email: 's@example.test' });
  const inOrg = await seedSharedOrganization(database, [a.user.id, b.user.id, c.user.id]);
  owner = inOrg(a.user.id);
  viewer = inOrg(b.user.id);
  stranger = inOrg(c.user.id);

  const list = await createList(owner, { name: 'Work' }, database);
  await shareList(
    owner,
    { listId: list.id, email: 'viewer@example.test', role: 'viewer' },
    database,
  );
  const item = await createTodo(owner, { listId: list.id, title: 'Task' }, database);
  if (!item) throw new Error('setup failed');
  todoId = item.id;
});

afterEach(async () => {
  await database.close();
});

const upload = (scope: Scope, name = 'notes.txt', body = 'hello', type = 'text/plain') =>
  uploadAttachment(
    scope,
    { todoId, filename: name, contentType: type, data: bytes(body) },
    database,
  );

describe('uploading', () => {
  it('stores the file and records it', async () => {
    const result = await upload(owner);
    expect(result.ok).toBe(true);

    const rows = await listAttachments(owner, todoId, database);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filename).toBe('notes.txt');
    expect(storage.objects.size).toBe(1);
  });

  it('generates its own storage key rather than trusting the filename', async () => {
    await upload(owner, '../../etc/passwd');
    const [key] = [...storage.objects.keys()];

    // The key is a UUID chosen by the storage layer; a user-supplied name never becomes a
    // path. The displayed filename is stripped of directories separately.
    expect(key).not.toContain('..');
    expect(key).not.toContain('/');
    expect((await listAttachments(owner, todoId, database))[0]?.filename).toBe('passwd');
  });

  it('refuses a file over the limit', async () => {
    const result = await uploadAttachment(
      owner,
      {
        todoId,
        filename: 'big.txt',
        contentType: 'text/plain',
        data: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      },
      database,
    );
    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(storage.objects.size).toBe(0);
  });

  it('refuses a type outside the allow-list', async () => {
    const result = await upload(owner, 'run.sh', '#!/bin/sh', 'application/x-sh');
    expect(result).toEqual({ ok: false, reason: 'unsupported-type' });
    expect(storage.objects.size).toBe(0);
  });

  it('refuses an empty file', async () => {
    const result = await uploadAttachment(
      owner,
      { todoId, filename: 'empty.txt', contentType: 'text/plain', data: new Uint8Array(0) },
      database,
    );
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('writes nothing when the caller may not edit', async () => {
    // Checked before a single byte is stored.
    expect(await upload(viewer)).toEqual({ ok: false, reason: 'not-found' });
    expect(await upload(stranger)).toEqual({ ok: false, reason: 'not-found' });
    expect(storage.objects.size).toBe(0);
  });
});

describe('reading', () => {
  it('returns the bytes to someone who can see the todo', async () => {
    await upload(owner, 'notes.txt', 'hello world');
    const read = await readAttachment(
      viewer,
      (await listAttachments(owner, todoId, database))[0]?.id ?? '',
      database,
    );
    expect(new TextDecoder().decode(read?.data)).toBe('hello world');
  });

  it('returns nothing to someone who cannot', async () => {
    await upload(owner);
    const id = (await listAttachments(owner, todoId, database))[0]?.id ?? '';
    expect(await readAttachment(stranger, id, database)).toBeNull();
    expect(await listAttachments(stranger, todoId, database)).toEqual([]);
  });
});

describe('deleting', () => {
  it('removes the row and queues the blob, then sweeps it', async () => {
    await upload(owner);
    const id = (await listAttachments(owner, todoId, database))[0]?.id ?? '';

    expect(await deleteAttachment(owner, id, database)).toBe(true);
    expect(await listAttachments(owner, todoId, database)).toEqual([]);

    // The blob survives the row on purpose: an unreferenced file costs storage, whereas a
    // row pointing at a missing file is a download that fails in front of a user.
    expect(storage.objects.size).toBe(1);
    expect(await database.select().from(orphanedBlob)).toHaveLength(1);

    await scheduleSweep(database);
    await runJobs(attachmentHandlers, { database });

    expect(storage.objects.size).toBe(0);
    expect(await database.select().from(orphanedBlob)).toHaveLength(0);
  });

  it('a viewer cannot delete', async () => {
    await upload(owner);
    const id = (await listAttachments(owner, todoId, database))[0]?.id ?? '';
    expect(await deleteAttachment(viewer, id, database)).toBe(false);
    expect(await listAttachments(owner, todoId, database)).toHaveLength(1);
  });

  it('deleting the todo orphans its blobs rather than leaking them', async () => {
    await upload(owner, 'a.txt');
    await upload(owner, 'b.txt');
    expect(storage.objects.size).toBe(2);

    await deleteTodo(owner, todoId, database);

    // The attachment rows went by cascade, which never touches storage — so the blobs are
    // recorded before the delete, in the same transaction.
    expect(await database.select().from(orphanedBlob)).toHaveLength(2);

    await scheduleSweep(database);
    await runJobs(attachmentHandlers, { database });
    expect(storage.objects.size).toBe(0);
  });

  it('sweeping twice is harmless', async () => {
    await upload(owner);
    const id = (await listAttachments(owner, todoId, database))[0]?.id ?? '';
    await deleteAttachment(owner, id, database);

    await scheduleSweep(database);
    await runJobs(attachmentHandlers, { database });
    await runJobs(attachmentHandlers, { database });

    expect(storage.objects.size).toBe(0);
  });
});
