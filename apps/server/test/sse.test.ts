import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

describe('Server SSE Events API', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await setupTestApp('sse');

    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'sse@example.com', password: 'password123' },
    });
    token = reg.json().accessToken;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('issues short-lived events token', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/sync/events-token',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.expiresIn).toBe(300);
  });

  it('rejects events stream request without valid token', async () => {
    const missingRes = await ctx.app.inject({
      method: 'GET',
      url: '/sync/events',
    });
    expect(missingRes.statusCode).toBe(401);

    const invalidRes = await ctx.app.inject({
      method: 'GET',
      url: '/sync/events?token=invalid.jwt.token',
    });
    expect(invalidRes.statusCode).toBe(401);
  });
});
