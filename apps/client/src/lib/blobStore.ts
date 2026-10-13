import { db } from '../db';
import { isTauri } from './tauri';

export interface BlobStore {
  get(hash: string): Promise<Blob | null>;
  put(hash: string, blob: Blob): Promise<void>;
  has(hash: string): Promise<boolean>;
  delete(hash: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Web & fallback implementation backed by Dexie IndexedDB (`db.files`).
 */
export class IndexedDbBlobStore implements BlobStore {
  async get(hash: string): Promise<Blob | null> {
    const row = await db.files.get(hash);
    return row?.blob ?? null;
  }

  async put(hash: string, blob: Blob): Promise<void> {
    await db.files.put({ hash, blob });
  }

  async has(hash: string): Promise<boolean> {
    const count = await db.files.where('hash').equals(hash).count();
    return count > 0;
  }

  async delete(hash: string): Promise<void> {
    await db.files.delete(hash);
  }

  async clear(): Promise<void> {
    await db.files.clear();
  }
}

/**
 * Desktop filesystem implementation backed by Tauri `@tauri-apps/plugin-fs`.
 * Stores files under `$APPDATA/Folio/files/<hash>`.
 */
export class FsBlobStore implements BlobStore {
  private fallback = new IndexedDbBlobStore();
  private baseDirPromise: Promise<string> | null = null;

  private async getFilesDir(): Promise<string> {
    if (!this.baseDirPromise) {
      this.baseDirPromise = (async () => {
        try {
          const { appDataDir, join } = await import('@tauri-apps/api/path');
          const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
          const appData = await appDataDir();
          const filesDir = await join(appData, 'Folio', 'files');
          const dirExists = await exists(filesDir);
          if (!dirExists) {
            await mkdir(filesDir, { recursive: true });
          }
          return filesDir;
        } catch {
          return '';
        }
      })();
    }
    return this.baseDirPromise;
  }

  private async getFilePath(hash: string): Promise<string> {
    const dir = await this.getFilesDir();
    if (!dir) return '';
    const { join } = await import('@tauri-apps/api/path');
    return await join(dir, hash);
  }

  async get(hash: string): Promise<Blob | null> {
    try {
      const path = await this.getFilePath(hash);
      if (!path) return await this.fallback.get(hash);

      const { readFile, exists } = await import('@tauri-apps/plugin-fs');
      if (!(await exists(path))) {
        // Fallback to IndexedDB if not yet migrated or stored there
        return await this.fallback.get(hash);
      }
      const data = await readFile(path);
      return new Blob([data]);
    } catch {
      return await this.fallback.get(hash);
    }
  }

  async put(hash: string, blob: Blob): Promise<void> {
    try {
      const path = await this.getFilePath(hash);
      if (!path) {
        await this.fallback.put(hash, blob);
        return;
      }

      const { writeFile } = await import('@tauri-apps/plugin-fs');
      const buffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      await writeFile(path, uint8);
    } catch {
      await this.fallback.put(hash, blob);
    }
  }

  async has(hash: string): Promise<boolean> {
    try {
      const path = await this.getFilePath(hash);
      if (!path) return await this.fallback.has(hash);

      const { exists } = await import('@tauri-apps/plugin-fs');
      const inFs = await exists(path);
      if (inFs) return true;
      return await this.fallback.has(hash);
    } catch {
      return await this.fallback.has(hash);
    }
  }

  async delete(hash: string): Promise<void> {
    try {
      const path = await this.getFilePath(hash);
      if (path) {
        const { remove, exists } = await import('@tauri-apps/plugin-fs');
        if (await exists(path)) {
          await remove(path);
        }
      }
    } catch {
      // Ignore
    }
    await this.fallback.delete(hash);
  }

  async clear(): Promise<void> {
    await this.fallback.clear();
  }
}

let storeSingleton: BlobStore | null = null;

/**
 * Returns the active BlobStore for the current runtime environment.
 */
export function getBlobStore(): BlobStore {
  if (!storeSingleton) {
    if (isTauri()) {
      storeSingleton = new FsBlobStore();
    } else {
      storeSingleton = new IndexedDbBlobStore();
    }
  }
  return storeSingleton;
}

export async function getFileBlob(hash: string): Promise<Blob | null> {
  return await getBlobStore().get(hash);
}

export async function saveFileBlob(hash: string, blob: Blob): Promise<void> {
  await getBlobStore().put(hash, blob);
}

export async function deleteFileBlob(hash: string): Promise<void> {
  await getBlobStore().delete(hash);
}

/**
 * Migrates existing IndexedDB blobs to filesystem storage on first launch.
 */
export async function migrateBlobsToFs(
  onProgress?: (done: number, total: number) => void,
): Promise<{ migrated: number; total: number }> {
  if (!isTauri()) return { migrated: 0, total: 0 };

  const fsStore = new FsBlobStore();
  const allRows = await db.files.toArray();
  const total = allRows.length;
  let migrated = 0;

  for (const row of allRows) {
    const alreadyInFs = await fsStore.has(row.hash);
    if (!alreadyInFs && row.blob) {
      await fsStore.put(row.hash, row.blob);
      migrated++;
    }
    onProgress?.(migrated, total);
  }

  return { migrated, total };
}
