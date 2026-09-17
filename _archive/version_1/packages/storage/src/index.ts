import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Blob storage.
 *
 * Four operations, because that is what every provider has in common and everything else
 * differs. Swapping local disk for S3, R2 or GCS means writing one object that satisfies
 * `StorageDriver` — no feature code changes, because features never see a provider.
 *
 * **Keys are generated here, never taken from the caller.** A filename supplied by a user
 * is attacker-controlled: `../../etc/passwd` traverses, a duplicate name overwrites
 * somebody else's file, and an unlucky one collides. The original name is metadata to show
 * the user; the key is a UUID this module chooses.
 */
export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  /** SHA-256 of the contents, for integrity checks and duplicate detection. */
  digest: string;
}

export interface StorageDriver {
  name: string;
  put: (data: Uint8Array, contentType: string) => Promise<StoredObject>;
  get: (key: string) => Promise<Uint8Array | null>;
  remove: (key: string) => Promise<boolean>;
  exists: (key: string) => Promise<boolean>;
}

/** Files under a directory. Fine for development and single-node deployments. */
export function diskDriver(root = '.keel/storage'): StorageDriver {
  // Keys are UUIDs generated below, so they cannot traverse — but resolve and check
  // anyway, because this is the one place a bad key would become a bad path.
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) {
      throw new Error(`Refusing to resolve a key outside the storage root: ${key}`);
    }
    return full;
  };

  return {
    name: 'disk',
    async put(data, contentType) {
      const key = `${randomUUID()}`;
      const full = resolve(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
      return {
        key,
        size: data.byteLength,
        contentType,
        digest: createHash('sha256').update(data).digest('hex'),
      };
    },
    async get(key) {
      try {
        return new Uint8Array(await fs.readFile(resolve(key)));
      } catch {
        return null;
      }
    },
    async remove(key) {
      try {
        await fs.unlink(resolve(key));
        return true;
      } catch {
        return false;
      }
    },
    async exists(key) {
      try {
        await fs.access(resolve(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** In-memory. For tests, and for asserting what would have been written. */
export function memoryDriver(): StorageDriver & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    name: 'memory',
    objects,
    async put(data, contentType) {
      const key = randomUUID();
      objects.set(key, data);
      return {
        key,
        size: data.byteLength,
        contentType,
        digest: createHash('sha256').update(data).digest('hex'),
      };
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async remove(key) {
      return objects.delete(key);
    },
    async exists(key) {
      return objects.has(key);
    },
  };
}

let driver: StorageDriver | undefined;

export function setStorageDriver(next: StorageDriver): void {
  driver = next;
}

/** Lazy, like every other resource here — choosing at import time would read the env. */
export function storage(): StorageDriver {
  driver ??= diskDriver(process.env.KEEL_STORAGE_DIR);
  return driver;
}
