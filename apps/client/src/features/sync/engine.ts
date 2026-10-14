import { create } from 'zustand';
import { db, SYNC_TABLES, now, dirty, deviceId } from '../../db';
import {
  syncPush,
  syncPull,
  putFile,
  getFile,
  listFiles,
  syncEventsToken,
  AccountDeletedError,
} from './api';
import { getAuthUser, getRefreshToken, getServerUrl, clearAuth } from '../auth/storage';
import type { SyncTableName } from '@verso/shared';

/**
 * Sync bookkeeping, scoped to one server database + account. The cursor and the
 * set of files known to be on the server are only meaningful for the database
 * they came from: after the server's database or bucket is wiped, or the app is
 * pointed at another server or account, they must be reset, otherwise the
 * client never re-pulls (cursor ahead of the new sequence) or re-uploads (it
 * "knows" the files are there).
 */
interface SyncBookkeeping {
  scope: string;
  cursor: number;
  uploaded: string[];
  lastFileCheck: number;
}
const SYNC_STATE_KEY = 'sync_state';
// How often to compare local files with the server's file list (self-heals a
// wiped or partially lost bucket) even when nothing else changed.
const FILE_RECONCILE_MS = 10 * 60_000;
// The device row is refreshed this rarely; writing it on every sync made every
// sync schedule the next one, so sync ran in a loop every ~2s.
const DEVICE_SEEN_MS = 12 * 60 * 60_000;

async function readSyncState(): Promise<SyncBookkeeping | null> {
  const row = await db.kv.get(SYNC_STATE_KEY);
  const v = row?.value as SyncBookkeeping | undefined;
  return v && typeof v.scope === 'string' ? v : null;
}

async function writeSyncState(state: SyncBookkeeping): Promise<void> {
  await db.kv.put({ key: SYNC_STATE_KEY, value: state });
}

/**
 * Marks every synced row for upload WITHOUT changing updated_at, so the server's
 * last-write-wins still keeps whichever copy really is newer. (Bumping
 * updated_at here let a long-offline device overwrite newer edits on sign-in.)
 */
export async function markAllForUpload(): Promise<void> {
  for (const table of SYNC_TABLES) {
    await db.table(table).toCollection().modify({ _dirty: 1 });
  }
}

/** Removes everything this device holds for the account (used on deletion/sign-out). */
export async function wipeLocalAccountData(): Promise<void> {
  for (const table of SYNC_TABLES) {
    await db.table(table).clear();
  }
  await db.files.clear();
  await db.covers.clear();
  await db.kv.bulkDelete([SYNC_STATE_KEY, 'sync_cursor', 'uploaded_files']);
}

// 'signedOut': no account, so nothing is synced (previously shown as 'idle' = "Synced").
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  pendingChanges: number;
  filesUploadingCount: number;
  filesUploadingTotal: number;
  isOnline: boolean;
  /** Set when the server reported this account deleted (local copy was wiped). */
  accountDeleted: boolean;
  runSync: () => Promise<void>;
  updatePendingCount: () => Promise<number>;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'signedOut',
  lastSyncAt: null,
  lastError: null,
  pendingChanges: 0,
  filesUploadingCount: 0,
  filesUploadingTotal: 0,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  accountDeleted: false,

  updatePendingCount: async () => {
    let count = 0;
    try {
      for (const table of SYNC_TABLES) {
        const dirtyInTable = await db[table].where('_dirty').equals(1).count();
        count += dirtyInTable;
      }
      set({ pendingChanges: count });
    } catch {
      // Ignore count errors if DB is closing/migrating
    }
    return count;
  },

  runSync: async () => {
    await syncEngine.runSync();
  },
}));

export class SyncEngine {
  private isRunning = false;
  private backoffAttempt = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private eventSource: EventSource | null = null;
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  async isUserSignedIn(): Promise<boolean> {
    const token = await getRefreshToken();
    return !!token;
  }

  // Device registration helper
  async registerDevice(): Promise<void> {
    try {
      const id = deviceId();
      let name = localStorage.getItem('folio_device_name');
      if (!name) {
        const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
        const isAndroid = typeof navigator !== 'undefined' && navigator.userAgent.includes('Android');
        name = isWindows ? 'Windows PC' : isAndroid ? 'Android Device' : 'Web Browser';
        localStorage.setItem('folio_device_name', name);
      }
      const platform = typeof window !== 'undefined' && '__TAURI__' in window
        ? (navigator.userAgent.includes('Android') ? 'android' : 'windows')
        : 'web';

      const existing = await db.devices.get(id);
      const fresh =
        existing &&
        !existing.deleted_at &&
        existing.name === name &&
        existing.platform === platform &&
        now() - (existing.last_seen_at ?? 0) < DEVICE_SEEN_MS;
      if (fresh) return;
      await db.devices.put({
        id,
        name,
        platform,
        last_seen_at: now(),
        deleted_at: null,
        ...dirty(),
      });
    } catch {
      // Device registration is non-fatal
    }
  }

  // Trigger sync with 2s debounce on local dirty writes
  scheduleDebouncedSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.runSync();
    }, 2000);
    void useSyncStore.getState().updatePendingCount();
  }

  // Core 5-stage sync algorithm per §6.4
  async runSync(): Promise<void> {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    useSyncStore.setState({ isOnline });

    if (!isOnline) {
      useSyncStore.setState({ status: 'offline' });
      return;
    }

    const signedIn = await this.isUserSignedIn();
    if (!signedIn) {
      useSyncStore.setState({ status: 'signedOut' });
      return;
    }

    if (this.isRunning) {
      return;
    }

    // Single-tab coordination via Web Locks API
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('folio-sync', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          // Another tab is actively holding the sync lock
          return;
        }
        await this.executeSyncStages();
      });
    } else {
      await this.executeSyncStages();
    }
  }

  private async executeSyncStages(): Promise<void> {
    this.isRunning = true;
    useSyncStore.setState({ status: 'syncing', lastError: null });

    try {
      // Stage 0: which server database + account is this? Reset if it changed.
      const state = await this.resolveScope();

      // Register current device first
      await this.registerDevice();

      // Stage 1: PUSH
      await this.stage1Push();

      // Stage 2: FILES UP
      await this.stage2FilesUp(state);

      // Stage 3: PULL
      await this.stage3Pull(state);

      // Stage 4: FILES DOWN
      await this.stage4FilesDown();

      // Stage 5: Success
      useSyncStore.setState({
        status: 'idle',
        lastSyncAt: Date.now(),
        lastError: null,
      });
      this.backoffAttempt = 0;
      await useSyncStore.getState().updatePendingCount();
    } catch (err: unknown) {
      if (err instanceof AccountDeletedError) {
        await this.handleAccountDeleted();
        return;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      useSyncStore.setState({
        status: 'error',
        lastError: errorMessage,
      });

      // Exponential backoff 5s → 5m
      const delay = Math.min(300_000, 5000 * Math.pow(2, this.backoffAttempt));
      this.backoffAttempt++;
      if (this.backoffTimer) clearTimeout(this.backoffTimer);
      this.backoffTimer = setTimeout(() => {
        void this.runSync();
      }, delay);
    } finally {
      this.isRunning = false;
      await useSyncStore.getState().updatePendingCount();
    }
  }

  /**
   * Identifies the server database and account this device syncs with. When it
   * differs from what the stored cursor belongs to, starts over: cursor 0, no
   * files assumed uploaded, every local row queued for upload (timestamps kept).
   */
  private async resolveScope(): Promise<SyncBookkeeping> {
    const [serverUrl, user, probe] = await Promise.all([
      getServerUrl(),
      getAuthUser(),
      // since=MAX returns no rows, just the server's instance id.
      syncPull(Number.MAX_SAFE_INTEGER),
    ]);
    const scope = `${serverUrl}|${user?.id ?? ''}|${probe.instanceId ?? 'legacy'}`;
    const saved = await readSyncState();
    if (saved?.scope === scope) return saved;

    const fresh: SyncBookkeeping = { scope, cursor: 0, uploaded: [], lastFileCheck: 0 };
    await markAllForUpload();
    await db.kv.bulkDelete(['sync_cursor', 'uploaded_files']);
    await writeSyncState(fresh);
    return fresh;
  }

  /** The server says the account no longer exists: wipe this device's copy. */
  private async handleAccountDeleted(): Promise<void> {
    this.disconnectSSE();
    await wipeLocalAccountData();
    await clearAuth();
    useSyncStore.setState({
      status: 'signedOut',
      lastError: 'This account was deleted. Its data has been removed from this device.',
      accountDeleted: true,
    });
  }

  // 1) PUSH
  private async stage1Push(): Promise<void> {
    for (const table of SYNC_TABLES) {
      const targetTable = db.table(table);
      while (true) {
        // Query dirty rows in batches of 500
        const dirtyRows = await targetTable.where('_dirty').equals(1).limit(500).toArray();
        if (dirtyRows.length === 0) break;

        const cleanRows = dirtyRows.map((r: { _dirty?: number }) => {
          const { _dirty, ...rest } = r;
          return rest as Record<string, unknown>;
        });

        const res = await syncPush({ [table]: cleanRows });
        const winners = new Map<string, Record<string, unknown>>(
          (res.serverRows?.[table] ?? []).map((r) => [String(r.id), r]),
        );

        // Compare-and-set: only rows unchanged since we read them are settled.
        // A rejected (stale) row takes the server's winning copy, so this device
        // converges instead of keeping its losing edit forever.
        await db.transaction('rw', targetTable, async () => {
          for (const row of dirtyRows) {
            const current = await targetTable.get(row.id);
            if (!current || current.updated_at !== row.updated_at) continue;
            const winner = winners.get(String(row.id));
            if (winner) await targetTable.put({ ...winner, _dirty: 0 });
            else await targetTable.update(row.id, { _dirty: 0 });
          }
        });

        if (dirtyRows.length < 500) break;
      }
    }
  }

  // 2) FILES UP
  private async stage2FilesUp(state: SyncBookkeeping): Promise<void> {
    const uploaded = new Set<string>(state.uploaded);

    // Periodically (and right after a reset) trust the server's actual file list
    // over the local "already uploaded" memory, so a wiped or partly lost bucket
    // is refilled from whichever devices still have the files.
    if (Date.now() - state.lastFileCheck > FILE_RECONCILE_MS) {
      const onServer = new Set((await listFiles()).map((f) => f.hash));
      uploaded.clear();
      for (const h of onServer) uploaded.add(h);
      state.lastFileCheck = Date.now();
    }

    const pending: Array<{ hash: string; getBlob: () => Promise<Blob | null> }> = [];
    const books = await db.books.filter((b) => !b.deleted_at).toArray();
    for (const book of books) {
      if (book.file_hash && !uploaded.has(book.file_hash)) {
        pending.push({ hash: book.file_hash, getBlob: async () => (await db.files.get(book.file_hash))?.blob ?? null });
      }
      // Covers are stored under the book id; cover_hash is the hash of that image.
      // (Looking them up by cover_hash found nothing, so covers never uploaded.)
      if (book.cover_hash && !uploaded.has(book.cover_hash)) {
        pending.push({ hash: book.cover_hash, getBlob: async () => (await db.covers.get(book.id))?.blob ?? null });
      }
    }

    if (pending.length > 0) {
      useSyncStore.setState({ filesUploadingCount: 0, filesUploadingTotal: pending.length });
      let index = 0;
      let completed = 0;
      const worker = async () => {
        while (index < pending.length) {
          const item = pending[index++];
          if (!item) break;
          try {
            const blob = await item.getBlob();
            if (blob) {
              await putFile(item.hash, blob); // server answers "exists" if already stored
              uploaded.add(item.hash);
            }
          } catch (err) {
            if (err instanceof AccountDeletedError) throw err;
            // Other per-file errors don't fail the sync; the file is retried next time.
          } finally {
            completed++;
            useSyncStore.setState({ filesUploadingCount: completed });
          }
        }
      };
      await Promise.all([worker(), worker()]);
      useSyncStore.setState({ filesUploadingCount: 0, filesUploadingTotal: 0 });
    }

    state.uploaded = Array.from(uploaded);
    await writeSyncState(state);
  }

  // 3) PULL
  private async stage3Pull(state: SyncBookkeeping): Promise<void> {
    let cursor = state.cursor;

    while (true) {
      const page = await syncPull(cursor);
      const tableNames = Object.keys(page.changes) as SyncTableName[];

      if (tableNames.length > 0) {
        const tablesToLock = tableNames.map((t) => db.table(t));
        await db.transaction('rw', [...tablesToLock, db.kv], async () => {
          for (const table of tableNames) {
            const rows = page.changes[table];
            if (!rows || rows.length === 0) continue;
            const targetTable = db.table(table);

            for (const r of rows) {
              const row = r as unknown as { id: string; updated_at: number; [key: string]: unknown };
              const local = (await targetTable.get(row.id)) as { updated_at: number; _dirty: number } | undefined;
              if (!local) {
                await targetTable.put({ ...row, _dirty: 0 });
              } else if (local._dirty === 0) {
                await targetTable.put({ ...row, _dirty: 0 });
              } else if (row.updated_at > local.updated_at) {
                await targetTable.put({ ...row, _dirty: 0 });
              } else {
                // local._dirty === 1 and local.updated_at >= row.updated_at: keep local
              }
            }
          }
          state.cursor = page.cursor;
          await db.kv.put({ key: SYNC_STATE_KEY, value: state });
        });
      } else {
        state.cursor = page.cursor;
        await writeSyncState(state);
      }

      cursor = page.cursor;
      if (!page.hasMore) break;
    }
  }

  // 4) FILES DOWN
  private async stage4FilesDown(): Promise<void> {
    // Missing cover hashes: download immediately
    const books = await db.books.filter((b) => !!b.cover_hash && !b.deleted_at).toArray();
    for (const book of books) {
      const coverHash = book.cover_hash!;
      // The UI reads covers by book id. Older versions saved downloads under the
      // cover hash, where they were never shown: move those over.
      if (await db.covers.get(book.id)) continue;
      const misfiled = await db.covers.get(coverHash);
      if (misfiled) {
        await db.covers.put({ id: book.id, blob: misfiled.blob });
        continue;
      }
      try {
        const blob = await getFile(coverHash);
        await db.covers.put({ id: book.id, blob });
      } catch (err) {
        if (err instanceof AccountDeletedError) throw err;
        // Skip on cover download error; retried next sync.
      }
    }

    // Check if "Download all books" is enabled in settings
    const settingsRow = await db.settings.get('sync');
    const syncSettings = settingsRow?.data as { download_all_books?: boolean } | undefined;
    if (syncSettings?.download_all_books) {
      const allBooks = await db.books.filter((b) => !b.deleted_at).toArray();
      for (const book of allBooks) {
        const existing = await db.files.get(book.file_hash);
        if (!existing) {
          try {
            const blob = await getFile(book.file_hash);
            await db.files.put({ hash: book.file_hash, blob });
          } catch {
            // Skip individual file failures
          }
        }
      }
    }
  }

  // SSE event stream listener
  async connectSSE(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const signedIn = await this.isUserSignedIn();
    if (!signedIn || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    try {
      const { token } = await syncEventsToken();
      const serverUrl = await getServerUrl();
      const es = new EventSource(`${serverUrl}/sync/events?token=${token}`);

      es.addEventListener('changed', () => {
        void this.runSync();
      });

      es.onerror = () => {
        es.close();
        this.eventSource = null;
        if (this.sseReconnectTimer) clearTimeout(this.sseReconnectTimer);
        this.sseReconnectTimer = setTimeout(() => {
          void this.connectSSE();
        }, 5000);
      };

      this.eventSource = es;
    } catch (err) {
      if (err instanceof AccountDeletedError) {
        await this.handleAccountDeleted();
        return;
      }
      if (this.sseReconnectTimer) clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = setTimeout(() => {
        void this.connectSSE();
      }, 10000);
    }
  }

  disconnectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
  }

  // Set up all triggers per Task 4.4
  init(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    // Window focus / visibility
    window.addEventListener('focus', () => {
      void this.runSync();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void this.runSync();
      }
    });

    // Online / Offline
    window.addEventListener('online', () => {
      useSyncStore.setState({ isOnline: true });
      void this.runSync();
      void this.connectSSE();
    });

    window.addEventListener('offline', () => {
      useSyncStore.setState({ isOnline: false, status: 'offline' });
      this.disconnectSSE();
    });

    // 30s interval while visible
    this.intervalTimer = setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        void this.runSync();
      }
    }, 30000);

    // Dexie table write hooks on synced tables (debounced 2s)
    for (const table of SYNC_TABLES) {
      db[table].hook('creating', (_primKey, obj) => {
        if (obj && (obj as { _dirty?: number })._dirty === 1) {
          this.scheduleDebouncedSync();
        }
      });
      db[table].hook('updating', (modifications) => {
        if (modifications && (modifications as { _dirty?: number })._dirty === 1) {
          this.scheduleDebouncedSync();
        }
      });
      db[table].hook('deleting', () => {
        this.scheduleDebouncedSync();
      });
    }

    // Startup sync & SSE connection
    void this.runSync();
    void this.connectSSE();
  }

  destroy(): void {
    this.disconnectSSE();
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.initialized = false;
  }
}

export const syncEngine = new SyncEngine();
