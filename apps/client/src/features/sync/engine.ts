import { create } from 'zustand';
import { db, SYNC_TABLES, now, dirty, deviceId } from '../../db';
import {
  syncPush,
  syncPull,
  headFile,
  putFile,
  getFile,
  syncEventsToken,
} from './api';
import { getRefreshToken, getServerUrl } from '../auth/storage';
import type { SyncTableName } from '@verso/shared';

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
      // Register current device first
      await this.registerDevice();

      // Stage 1: PUSH
      await this.stage1Push();

      // Stage 2: FILES UP
      await this.stage2FilesUp();

      // Stage 3: PULL
      await this.stage3Pull();

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

        await syncPush({ [table]: cleanRows });

        // Compare-and-set Dexie transaction
        await db.transaction('rw', targetTable, async () => {
          for (const row of dirtyRows) {
            const current = await targetTable.get(row.id);
            if (current && current.updated_at === row.updated_at) {
              await targetTable.update(row.id, { _dirty: 0 });
            }
          }
        });

        if (dirtyRows.length < 500) break;
      }
    }
  }

  // 2) FILES UP
  private async stage2FilesUp(): Promise<void> {
    const uploadedRow = await db.kv.get('uploaded_files');
    const uploadedSet = new Set<string>(
      Array.isArray(uploadedRow?.value) ? uploadedRow.value : [],
    );

    const pendingUploads: Array<{ hash: string; getBlob: () => Promise<Blob | null> }> = [];

    // Check books where file_hash is not uploaded and blob exists
    const books = await db.books.toArray();
    for (const book of books) {
      if (book.file_hash && !uploadedSet.has(book.file_hash)) {
        pendingUploads.push({
          hash: book.file_hash,
          getBlob: async () => {
            const fileRow = await db.files.get(book.file_hash);
            return fileRow?.blob || null;
          },
        });
      }
      if (book.cover_hash && !uploadedSet.has(book.cover_hash)) {
        pendingUploads.push({
          hash: book.cover_hash,
          getBlob: async () => {
            const coverRow = await db.covers.get(book.cover_hash!);
            return coverRow?.blob || null;
          },
        });
      }
    }

    if (pendingUploads.length === 0) return;

    useSyncStore.setState({
      filesUploadingCount: 0,
      filesUploadingTotal: pendingUploads.length,
    });

    // Concurrency limit 2
    let index = 0;
    let completed = 0;

    const worker = async () => {
      while (index < pendingUploads.length) {
        const item = pendingUploads[index++];
        if (!item) break;
        try {
          const blob = await item.getBlob();
          if (blob) {
            const exists = await headFile(item.hash);
            if (!exists) {
              await putFile(item.hash, blob);
            }
            uploadedSet.add(item.hash);
          }
        } catch {
          // Individual upload errors do not fail the sync stage
        } finally {
          completed++;
          useSyncStore.setState({ filesUploadingCount: completed });
        }
      }
    };

    await Promise.all([worker(), worker()]);

    await db.kv.put({
      key: 'uploaded_files',
      value: Array.from(uploadedSet),
    });

    useSyncStore.setState({
      filesUploadingCount: 0,
      filesUploadingTotal: 0,
    });
  }

  // 3) PULL
  private async stage3Pull(): Promise<void> {
    const cursorRow = await db.kv.get('sync_cursor');
    let cursor = typeof cursorRow?.value === 'number' ? cursorRow.value : 0;

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
          await db.kv.put({ key: 'sync_cursor', value: page.cursor });
        });
      } else {
        await db.kv.put({ key: 'sync_cursor', value: page.cursor });
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
      const existing = await db.covers.get(coverHash);
      if (!existing) {
        try {
          const blob = await getFile(coverHash);
          await db.covers.put({ id: coverHash, blob });
        } catch {
          // Skip on cover download error
        }
      }
    }

    // Check if "Download all books" is enabled in settings
    const settingsRow = await db.settings.get('sync');
    const syncSettings = settingsRow?.data as { download_all_books?: boolean } | undefined;
    if (syncSettings?.download_all_books) {
      for (const book of books) {
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
    } catch {
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
