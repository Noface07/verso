import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

describe('Server Auth API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestApp('auth');
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('registers a new user and issues tokens', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'reader@example.com',
        password: 'password123',
        deviceName: 'Test Laptop',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.user.email).toBe('reader@example.com');
    expect(body.user.id).toBeDefined();
  });

  it('rejects duplicate email registration with 409', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'password123' },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('email already registered');
  });

  it('logs in an existing user with correct credentials', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'login@example.com', password: 'password123' },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@example.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
  });

  it('rejects login with incorrect password with 401', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'wrong@example.com', password: 'password123' },
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'wrong@example.com', password: 'wrongpassword' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse of old refresh token', async () => {
    const regRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'rotate@example.com', password: 'password123' },
    });
    const { refreshToken: token1 } = regRes.json();

    // First rotation
    const refreshRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token1 },
    });

    expect(refreshRes.statusCode).toBe(200);
    const { refreshToken: token2, accessToken: access2 } = refreshRes.json();
    expect(token2).toBeDefined();
    expect(token2).not.toBe(token1);
    expect(access2).toBeDefined();

    // Old token reuse MUST be rejected
    const reuseRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token1 },
    });
    expect(reuseRes.statusCode).toBe(401);

    // New token must work
    const secondRefresh = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token2 },
    });
    expect(secondRefresh.statusCode).toBe(200);
  });

  it('revokes refresh token on logout', async () => {
    const regRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'logout@example.com', password: 'password123' },
    });
    const { refreshToken } = regRes.json();

    const logoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json().ok).toBe(true);

    // Subsequent refresh must fail
    const refreshRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
  });
});
