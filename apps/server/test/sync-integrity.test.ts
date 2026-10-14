import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

const book = (id: string, title: string, updated_at: number) => ({
  id,
  title,
  author: 'A',
  format: 'epub',
  file_hash: 'a'.repeat(64),
  file_size: 1,
  updated_at,
  deleted_at: null,
});

describe('Sync integrity', () => {
  let ctx: TestContext;
  let access: string;
  let refresh: string;
  let userId: string;

  beforeEach(async () => {
    ctx = await setupTestApp('integrity');
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'integrity@example.com', password: 'password123' },
    });
    ({ accessToken: access, refreshToken: refresh } = reg.json());
    userId = reg.json().user.id;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const push = (rows: unknown[]) =>
    ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${access}` },
      payload: { changes: { books: rows } },
    });

  it('returns the winning row for a stale push so the losing device converges', async () => {
    await push([book('b1', 'Newer title', 2000)]);
    const res = await push([book('b1', 'Older title', 1000)]);
    const body = res.json();
    expect(body.stale).toBe(1);
    expect(body.staleIds.books).toEqual(['b1']);
    expect(body.serverRows.books).toHaveLength(1);
    expect(body.serverRows.books[0]).toMatchObject({ id: 'b1', title: 'Newer title' });
    expect(body.serverRows.books[0].user_id).toBeUndefined();
  });

  it('reports the server instance id on pull', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/sync/pull?since=0',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.json().instanceId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects a deleted account’s still-valid access token with account_deleted', async () => {
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/account',
      headers: { authorization: `Bearer ${access}` },
    });
    expect(del.statusCode).toBe(200);

    const after = await push([book('b2', 'Ghost write', 3000)]);
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe('account_deleted');
  });

  it('tells a device refreshing after deletion that the account is gone', async () => {
    await ctx.app.inject({ method: 'DELETE', url: '/account', headers: { authorization: `Bearer ${access}` } });

    const withHint = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: refresh, userId },
    });
    expect(withHint.statusCode).toBe(401);
    expect(withHint.json().code).toBe('account_deleted');

    // Without the hint it is an ordinary invalid token.
    const noHint = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: refresh } });
    expect(noHint.statusCode).toBe(401);
    expect(noHint.json().code).toBeUndefined();
  });

  it('lets the same email register again after deletion, with no old data', async () => {
    await push([book('b3', 'Old data', 1000)]);
    await ctx.app.inject({ method: 'DELETE', url: '/account', headers: { authorization: `Bearer ${access}` } });

    const again = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'integrity@example.com', password: 'password123' },
    });
    expect(again.statusCode).toBe(201);
    const pull = await ctx.app.inject({
      method: 'GET',
      url: '/sync/pull?since=0',
      headers: { authorization: `Bearer ${again.json().accessToken}` },
    });
    expect(pull.json().changes.books ?? []).toHaveLength(0);
  });
});
