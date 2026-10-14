import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, type Book } from '../src/db';
import { getFile, ApiError } from '../src/features/sync/api';
import {
  setAccessToken,
  setRefreshToken,
  setAuthUser,
  clearAuth,
  getRefreshToken,
} from '../src/features/auth/storage';
import { syncEngine, useSyncStore } from '../src/features/sync/engine';

/** Minimal in-memory Verso server behind a mocked fetch. */
function fakeServer() {
  const state = {
    instanceId: 'instance-A',
    rows: new Map<string, Record<string, unknown>>(), // `${table}:${id}`
    seq: 0,
    files: new Set<string>(),
    pushed: [] as Record<string, unknown[]>[],
    deleted: false,
    refreshStatus: 200,
    storageOffline: false,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/auth/refresh') {
      if (state.deleted) return json({ error: 'account deleted', code: 'account_deleted' }, 401);
      if (state.refreshStatus !== 200) return json({ error: 'unavailable' }, state.refreshStatus);
      return json({ user: { id: 'u1', email: 'a@b.c' }, accessToken: 'acc2', refreshToken: 'ref2' });
    }
    if (state.deleted) return json({ error: 'account deleted', code: 'account_deleted' }, 401);
    if (url.pathname === '/sync/pull') {
      const since = Number(url.searchParams.get('since'));
      const changes: Record<string, unknown[]> = {};
      let cursor = since;
      for (const [key, row] of state.rows) {
        const seq = Number(row.server_seq);
        if (seq > since) {
          (changes[key.split(':')[0]] ??= []).push(row);
          cursor = Math.max(cursor, seq);
        }
      }
      return json({ changes, cursor, hasMore: false, serverTime: Date.now(), instanceId: state.instanceId });
    }
    if (url.pathname === '/sync/push') {
      const { changes } = JSON.parse(String(init?.body)) as { changes: Record<string, Record<string, unknown>[]> };
      state.pushed.push(changes);
      const serverRows: Record<string, unknown[]> = {};
      let stale = 0;
      for (const [table, list] of Object.entries(changes)) {
        for (const row of list) {
          const key = `${table}:${row.id}`;
          const cur = state.rows.get(key);
          if (cur && Number(row.updated_at) <= Number(cur.updated_at)) {
            stale++;
            (serverRows[table] ??= []).push(cur);
          } else {
            state.rows.set(key, { ...row, server_seq: ++state.seq });
          }
        }
      }
      return json({ accepted: 0, stale, invalid: 0, staleIds: {}, serverRows, serverTime: Date.now() });
    }
    if (url.pathname.startsWith('/files') && state.storageOffline) {
      return json({ error: 'book storage is offline', code: 'storage_offline' }, 503);
    }
    if (url.pathname === '/files' && method === 'GET') {
      return json([...state.files].map((hash) => ({ hash, size: 1 })));
    }
    if (url.pathname.startsWith('/files/') && method === 'PUT') {
      state.files.add(url.pathname.split('/')[2]);
      return json({ stored: true }, 201);
    }
    return json({ error: 'not found' }, 404);
  });
  return { state, handler };
}

const book = (id: string, updated_at: number, extra: Partial<Book> = {}): Book =>
  ({
    id,
    title: `Book ${id}`,
    author: 'A',
    format: 'EPUB',
    file_hash: id,
    file_size: 1,
    cover_hash: null,
    meta: {},
    added_at: 1,
    last_opened_at: null,
    updated_at,
    deleted_at: null,
    _dirty: 0,
    ...extra,
  }) as Book;

describe('Sync integrity (client)', () => {
  let server: ReturnType<typeof fakeServer>;

  beforeEach(async () => {
    await clearAuth();
    for (const t of ['books', 'devices', 'progress'] as const) await db[t].clear();
    await db.kv.clear();
    await db.files.clear();
    await db.covers.clear();
    setAccessToken('acc');
    await setRefreshToken('ref');
    await setAuthUser({ id: 'u1', email: 'a@b.c' });
    useSyncStore.setState({ accountDeleted: false, status: 'idle' });
    server = fakeServer();
    vi.stubGlobal('fetch', server.handler);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-uploads everything, keeping timestamps, when the server database is replaced', async () => {
    await db.books.put(book('b1', 1000));
    await syncEngine.runSync();
    expect(server.state.rows.get('books:b1')).toBeTruthy();

    // Server wiped and restarted with a new database (new instance id, seq restarts).
    server.state.rows.clear();
    server.state.seq = 0;
    server.state.instanceId = 'instance-B';
    server.state.pushed = [];
    await syncEngine.runSync();

    const pushedBooks = server.state.pushed.flatMap((c) => c.books ?? []) as Record<string, unknown>[];
    expect(pushedBooks.map((r) => r.id)).toContain('b1');
    // updated_at must be preserved (not bumped) so last-write-wins stays correct.
    expect(pushedBooks.find((r) => r.id === 'b1')?.updated_at).toBe(1000);
    expect(server.state.rows.get('books:b1')).toBeTruthy();
  });

  it('converges on the server copy when its push loses last-write-wins', async () => {
    server.state.rows.set('books:b2', { ...book('b2', 5000, { title: 'Winner' }), server_seq: ++server.state.seq });
    // This device has an older edit that it believes is unsynced. Pulling first
    // keeps it (local dirty), then the push is rejected as stale.
    await db.books.put({ ...book('b2', 1000, { title: 'Loser' }), _dirty: 1 });
    await db.kv.put({
      key: 'sync_state',
      value: { scope: 'http://localhost:8080|u1|instance-A', cursor: server.state.seq, uploaded: [], lastFileCheck: Date.now() },
    });
    await syncEngine.runSync();
    const local = await db.books.get('b2');
    expect(local?.title).toBe('Winner');
    expect(local?._dirty).toBe(0);
  });

  it('does not re-dirty the device row on every sync (no self-triggering loop)', async () => {
    await syncEngine.runSync();
    server.state.pushed = [];
    await syncEngine.runSync();
    const pushedDevices = server.state.pushed.flatMap((c) => c.devices ?? []);
    expect(pushedDevices).toHaveLength(0);
  });

  it('re-uploads book files missing from a wiped bucket', async () => {
    await db.books.put(book('c'.repeat(64), 1000, { file_hash: 'c'.repeat(64) }));
    await db.files.put({ hash: 'c'.repeat(64), blob: new Blob(['x']) });
    await syncEngine.runSync();
    expect(server.state.files.has('c'.repeat(64))).toBe(true);

    server.state.files.clear(); // bucket wiped
    // Force the periodic reconciliation to run now.
    const st = (await db.kv.get('sync_state'))!.value as Record<string, unknown>;
    await db.kv.put({ key: 'sync_state', value: { ...st, lastFileCheck: 0 } });
    await syncEngine.runSync();
    expect(server.state.files.has('c'.repeat(64))).toBe(true);
  });

  it('wipes the local copy and signs out when the account was deleted elsewhere', async () => {
    await db.books.put(book('b3', 1000));
    server.state.deleted = true;
    setAccessToken(null);
    await syncEngine.runSync();
    expect(await db.books.count()).toBe(0);
    expect(await getRefreshToken()).toBeNull();
    expect(useSyncStore.getState().accountDeleted).toBe(true);
    expect(useSyncStore.getState().status).toBe('signedOut');
  });

  it('keeps syncing data, and flags it, when the book storage (s3rver PC) is offline', async () => {
    server.state.storageOffline = true;
    await db.books.put({ ...book('e'.repeat(64), 1000, { file_hash: 'e'.repeat(64) }), _dirty: 1 });
    await db.files.put({ hash: 'e'.repeat(64), blob: new Blob(['y']) });
    await syncEngine.runSync();
    expect(server.state.rows.get(`books:${'e'.repeat(64)}`)).toBeTruthy(); // data still synced
    expect(useSyncStore.getState().status).toBe('idle');
    expect(useSyncStore.getState().storageOffline).toBe(true);

    server.state.storageOffline = false; // PC back on
    const st = (await db.kv.get('sync_state'))!.value as Record<string, unknown>;
    await db.kv.put({ key: 'sync_state', value: { ...st, lastFileCheck: 0 } });
    await syncEngine.runSync();
    expect(server.state.files.has('e'.repeat(64))).toBe(true);
    expect(useSyncStore.getState().storageOffline).toBe(false);
  });

  it('stays signed in when the server is temporarily unavailable during refresh', async () => {
    server.state.refreshStatus = 503;
    setAccessToken(null);
    await syncEngine.runSync();
    expect(await getRefreshToken()).toBe('ref');
    expect(useSyncStore.getState().status).toBe('error');
  });
});

describe('getFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a download whose content does not match its hash', async () => {
    setAccessToken('acc');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['<html>proxy error</html>']), { status: 200 })),
    );
    await expect(getFile('d'.repeat(64))).rejects.toBeInstanceOf(ApiError);
  });
});
