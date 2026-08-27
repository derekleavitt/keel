import { describe, expect, it } from 'vitest';
import { schema } from './schema.ts';
import { createTestDatabase, seedUser } from './testing.ts';

describe('test database', () => {
  it('applies committed migrations and round-trips a row', async () => {
    const database = await createTestDatabase();
    try {
      const user = await seedUser(database, { email: 'owner@example.test' });
      const rows = await database.select().from(schema.user);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe('owner@example.test');
      expect(user.emailVerified).toBe(true);
    } finally {
      await database.close();
    }
  });

  it('enforces the unique constraint on email', async () => {
    const database = await createTestDatabase();
    try {
      await seedUser(database, { id: 'a', email: 'dup@example.test' });
      await expect(seedUser(database, { id: 'b', email: 'dup@example.test' })).rejects.toThrow();
    } finally {
      await database.close();
    }
  });

  it('cascades session deletion from the owning user', async () => {
    const database = await createTestDatabase();
    try {
      const user = await seedUser(database);
      const now = new Date();
      await database.insert(schema.session).values({
        id: 'sess_1',
        token: 'tok_1',
        userId: user.id,
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now,
        updatedAt: now,
      });
      await database.delete(schema.user);
      expect(await database.select().from(schema.session)).toHaveLength(0);
    } finally {
      await database.close();
    }
  });
});
