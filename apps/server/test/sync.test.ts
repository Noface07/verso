import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

describe('Server Sync API', () => {
  let ctx: TestContext;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ctx = await setupTestApp('sync');

    const regA = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'userA@example.com', password: 'password123' },
    });
    tokenA = regA.json().accessToken;

    const regB = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'userB@example.com', password: 'password123' },
    });
    tokenB = regB.json().accessToken;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('implements Last-Write-Wins conflict resolution on push', async () => {
    const bookId = 'book-1';

    // 1. Initial push at updated_at = 1000
    const push1 = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        changes: {
          books: [
            {
              id: bookId,
              title: 'Original Title',
              author: 'Author A',
              format: 'epub',
              updated_at: 1000,
              deleted_at: null,
            },
          ],
        },
      },
    });

    expect(push1.statusCode).toBe(200);
    const body1 = push1.json();
    expect(body1.accepted).toBe(1);
    expect(body1.stale).toBe(0);
    expect(body1.serverTime).toBeGreaterThan(0);

    // 2. Out-of-order push with older updated_at = 500
    const pushOlder = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        changes: {
          books: [
            {
              id: bookId,
              title: 'Stale Title',
              author: 'Author A',
              format: 'epub',
              updated_at: 500,
              deleted_at: null,
            },
          ],
        },
      },
    });

    const bodyOlder = pushOlder.json();
    expect(bodyOlder.accepted).toBe(0);
    expect(bodyOlder.stale).toBe(1);
    expect(bodyOlder.staleIds.books).toContain(bookId);

    // 3. Equal updated_at = 1000 (server version wins)
    const pushEqual = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        changes: {
          books: [
            {
              id: bookId,
              title: 'Equal Title',
              author: 'Author A',
              format: 'epub',
              updated_at: 1000,
              deleted_at: null,
            },
          ],
        },
      },
    });

    const bodyEqual = pushEqual.json();
    expect(bodyEqual.accepted).toBe(0);
    expect(bodyEqual.stale).toBe(1);
    expect(bodyEqual.staleIds.books).toContain(bookId);

    // 4. Newer push at updated_at = 2000
    const pushNewer = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        changes: {
          books: [
            {
              id: bookId,
              title: 'Newest Title',
              author: 'Author A',
              format: 'epub',
              updated_at: 2000,
              deleted_at: null,
            },
          ],
        },
      },
    });

    const bodyNewer = pushNewer.json();
    expect(bodyNewer.accepted).toBe(1);
    expect(bodyNewer.stale).toBe(0);

    // Verify pull returns newest title
    const pull = await ctx.app.inject({
      method: 'GET',
      url: '/sync/pull?since=0',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(pull.statusCode).toBe(200);
    const pullBody = pull.json();
    expect(pullBody.changes.books).toHaveLength(1);
    expect(pullBody.changes.books[0].title).toBe('Newest Title');
  });

  it('pull returns changes and cursor, and separates user tenants', async () => {
    // User A pushes data
    await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        changes: {
          books: [{ id: 'userA-book', title: 'User A Secret Book', updated_at: 100 }],
          settings: [{ id: 'default', data: { theme: 'dark' }, updated_at: 100 }],
        },
      },
    });

    // User B pulls -> MUST NOT see User A's data
    const pullB = await ctx.app.inject({
      method: 'GET',
      url: '/sync/pull?since=0',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const bodyB = pullB.json();
    expect(bodyB.changes.books || []).toHaveLength(0);
    expect(bodyB.changes.settings || []).toHaveLength(0);

    // User A pulls -> sees their data and advancing cursor
    const pullA = await ctx.app.inject({
      method: 'GET',
      url: '/sync/pull?since=0',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const bodyA = pullA.json();
    expect(bodyA.changes.books).toHaveLength(1);
    expect(bodyA.changes.books[0].id).toBe('userA-book');
    expect(bodyA.cursor).toBeGreaterThan(0);
    expect(bodyA.serverTime).toBeGreaterThan(0);

    // Subsequent pull since cursor -> returns empty changes
    const nextPullA = await ctx.app.inject({
      method: 'GET',
      url: `/sync/pull?since=${bodyA.cursor}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const nextBodyA = nextPullA.json();
    expect(nextBodyA.changes.books || []).toHaveLength(0);
  });

  it('validates rows and increments invalid counter for malformed items', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        changes: {
          books: [
            { id: '', updated_at: 100 }, // invalid empty id
            { id: 'valid-book', updated_at: 100, title: 'Valid' },
            { id: 'bad-timestamp', updated_at: 'not-a-number' }, // invalid timestamp
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(1);
    expect(body.invalid).toBe(2);
  });
});
