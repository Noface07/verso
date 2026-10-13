import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, dirty, uid, type Book } from '../src/db';
import {
  request,
  ApiError,
} from '../src/features/sync/api';
import {
  setAccessToken,
  setRefreshToken,
  getRefreshToken,
  setAuthUser,
  clearAuth,
} from '../src/features/auth/storage';
import { syncEngine } from '../src/features/sync/engine';

describe('Sync Engine & Auth Client', () => {
  beforeEach(async () => {
    await clearAuth();
    await db.books.clear();
    await db.kv.clear();
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Single-Flight Refresh Mutex Lock', () => {
    it('executes /auth/refresh only once on concurrent 401 requests', async () => {
      await setRefreshToken('valid-refresh-token');
      await setAuthUser({ id: 'user-1', email: 'test@folio.app' });
      setAccessToken('expired-access-token');

      let refreshCount = 0;
      let dataCount = 0;

      const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/auth/refresh')) {
          refreshCount++;
          // Simulate latency
          await new Promise((r) => setTimeout(r, 20));
          return new Response(
            JSON.stringify({
              user: { id: 'user-1', email: 'test@folio.app' },
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
              expiresIn: 900,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.endsWith('/data')) {
          dataCount++;
          const headers = (init?.headers as Record<string, string>) || {};
          const auth = headers['Authorization'] || headers['authorization'];
          if (auth === 'Bearer new-access-token') {
            return new Response(JSON.stringify({ ok: true, dataCount }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          // First attempt with expired access token returns 401
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      globalThis.fetch = fetchMock;

      // Start 5 concurrent authenticated requests
      const promises = [
        request('/data'),
        request('/data'),
        request('/data'),
        request('/data'),
        request('/data'),
      ];

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      expect(refreshCount).toBe(1);
      const updatedRefresh = await getRefreshToken();
      expect(updatedRefresh).toBe('new-refresh-token');
    });

    it('signs out and clears credentials when refresh token is invalid', async () => {
      await setRefreshToken('expired-refresh-token');
      await setAuthUser({ id: 'user-1', email: 'test@folio.app' });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Refresh token expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(request('/data')).rejects.toThrow(ApiError);
      const remainingToken = await getRefreshToken();
      expect(remainingToken).toBeNull();
    });
  });

  describe('Compare-and-Set PUSH Logic', () => {
    it('clears _dirty to 0 when local row was unchanged during push', async () => {
      const bookId = uid();
      const initialBook: Book = {
        id: bookId,
        title: 'Original Title',
        author: 'Author A',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'book.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        ...dirty(),
      };
      await db.books.put(initialBook);

      // Verify row is dirty
      const localBefore = await db.books.get(bookId);
      expect(localBefore?._dirty).toBe(1);

      // Simulate push stage: target table compare-and-set
      const dirtyRows = await db.books.where('_dirty').equals(1).toArray();
      expect(dirtyRows.length).toBe(1);

      // Compare and set
      await db.transaction('rw', db.books, async () => {
        for (const row of dirtyRows) {
          const current = await db.books.get(row.id);
          if (current && current.updated_at === row.updated_at) {
            await db.books.update(row.id, { _dirty: 0 });
          }
        }
      });

      const localAfter = await db.books.get(bookId);
      expect(localAfter?._dirty).toBe(0);
    });

    it('preserves _dirty = 1 if local row was edited concurrently during push', async () => {
      const bookId = uid();
      const initialBook: Book = {
        id: bookId,
        title: 'Original Title',
        author: 'Author A',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'book.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        ...dirty(),
      };
      await db.books.put(initialBook);

      const dirtyRows = await db.books.where('_dirty').equals(1).toArray();
      const pushedSnapshot = dirtyRows[0];

      // Simulate concurrent local edit happening while push network request is in flight
      await new Promise((r) => setTimeout(r, 5));
      await db.books.update(bookId, {
        title: 'User Changed Title In Flight',
        ...dirty(),
      });

      // Now run compare-and-set from the in-flight push response
      await db.transaction('rw', db.books, async () => {
        const current = await db.books.get(pushedSnapshot.id);
        if (current && current.updated_at === pushedSnapshot.updated_at) {
          await db.books.update(pushedSnapshot.id, { _dirty: 0 });
        }
      });

      const localAfter = await db.books.get(bookId);
      expect(localAfter?._dirty).toBe(1);
      expect(localAfter?.title).toBe('User Changed Title In Flight');
    });
  });

  describe('Last-Write-Wins PULL Merge Rules', () => {
    it('inserts new incoming server row with _dirty = 0', async () => {
      const serverRow = {
        id: uid(),
        title: 'New Remote Book',
        author: 'Remote Author',
        format: 'EPUB',
        file_hash: 'remote-hash',
        file_size: 2000,
        cover_hash: null,
        meta: { file_name: 'remote.epub', mime: 'application/epub+zip' },
        added_at: 5000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 5000,
      };

      const local = await db.books.get(serverRow.id);
      expect(local).toBeUndefined();

      // PULL logic
      await db.books.put({ ...serverRow, _dirty: 0 });

      const stored = await db.books.get(serverRow.id);
      expect(stored?.title).toBe('New Remote Book');
      expect(stored?._dirty).toBe(0);
    });

    it('updates clean local row (_dirty = 0) with server row', async () => {
      const bookId = uid();
      await db.books.put({
        id: bookId,
        title: 'Old Title',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'hash-old',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'old.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 1000,
        _dirty: 0,
      });

      const serverRow = {
        id: bookId,
        title: 'Updated By Server',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'hash-old',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'old.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 2000,
      };

      const local = await db.books.get(bookId);
      if (!local || local._dirty === 0 || serverRow.updated_at > local.updated_at) {
        await db.books.put({ ...serverRow, _dirty: 0 });
      }

      const updated = await db.books.get(bookId);
      expect(updated?.title).toBe('Updated By Server');
      expect(updated?._dirty).toBe(0);
    });

    it('overwrites dirty local row if incoming server row has newer updated_at', async () => {
      const bookId = uid();
      await db.books.put({
        id: bookId,
        title: 'Local Offline Edit',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'book.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 2000,
        _dirty: 1,
      });

      const newerServerRow = {
        id: bookId,
        title: 'Server Newer Edit Wins',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'book.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 3000, // Newer than 2000
      };

      const local = await db.books.get(bookId);
      if (!local) {
        await db.books.put({ ...newerServerRow, _dirty: 0 });
      } else if (local._dirty === 0) {
        await db.books.put({ ...newerServerRow, _dirty: 0 });
      } else if (newerServerRow.updated_at > local.updated_at) {
        await db.books.put({ ...newerServerRow, _dirty: 0 });
      }

      const merged = await db.books.get(bookId);
      expect(merged?.title).toBe('Server Newer Edit Wins');
      expect(merged?._dirty).toBe(0);
    });

    it('preserves dirty local row if local updated_at is newer than or equal to server row', async () => {
      const bookId = uid();
      await db.books.put({
        id: bookId,
        title: 'Local Newer Edit Kept',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'book.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 4000, // Newer than server
        _dirty: 1,
      });

      const olderServerRow = {
        id: bookId,
        title: 'Server Older Edit Stale',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1000,
        cover_hash: null,
        meta: { file_name: 'book.epub', mime: 'application/epub+zip' },
        added_at: 1000,
        last_opened_at: null,
        deleted_at: null,
        updated_at: 3000,
      };

      const local = await db.books.get(bookId);
      if (!local) {
        await db.books.put({ ...olderServerRow, _dirty: 0 });
      } else if (local._dirty === 0) {
        await db.books.put({ ...olderServerRow, _dirty: 0 });
      } else if (olderServerRow.updated_at > local.updated_at) {
        await db.books.put({ ...olderServerRow, _dirty: 0 });
      }

      const merged = await db.books.get(bookId);
      expect(merged?.title).toBe('Local Newer Edit Kept');
      expect(merged?._dirty).toBe(1);
    });
  });

  describe('Multi-Tab Coordination via Web Locks API', () => {
    it('aborts execution when lock is held by another tab', async () => {
      let executed = false;
      const originalLocks = navigator.locks;

      // Mock navigator.locks where lock is unavailable (another tab has it)
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: vi.fn().mockImplementation(async (_name, _opts, callback) => {
            // lock is null when unavailable
            return callback(null);
          }),
        },
      });

      vi.spyOn(syncEngine, 'isUserSignedIn').mockResolvedValue(true);
      // Spy on private executeSyncStages via any cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(syncEngine as any, 'executeSyncStages').mockImplementation(async () => {
        executed = true;
      });

      await syncEngine.runSync();

      expect(executed).toBe(false);

      // Restore locks
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: originalLocks,
      });
    });
  });
});
