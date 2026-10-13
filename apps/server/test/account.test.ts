import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

describe('Server Account API', () => {
  let ctx: TestContext;
  let token: string;
  let refreshToken: string;

  beforeEach(async () => {
    ctx = await setupTestApp('account');

    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'account@example.com',
        password: 'password123',
        deviceName: 'Workstation',
      },
    });
    const body = reg.json();
    token = body.accessToken;
    refreshToken = body.refreshToken;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('retrieves account details with storage usage', async () => {
    // Upload a sample file to check storage quota reporting
    const content = Buffer.from('Testing storage quota');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    await ctx.app.inject({
      method: 'PUT',
      url: `/files/${hash}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      },
      payload: content,
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe('account@example.com');
    expect(body.storageUsed).toBe(content.length);
  });

  it('updates password and rejects with wrong current password', async () => {
    // 1. Wrong current password
    const wrongRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/account/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'wrong-pass', newPassword: 'newpassword123' },
    });
    expect(wrongRes.statusCode).toBe(401);

    // 2. Correct update
    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/account/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'password123', newPassword: 'newpassword123' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().ok).toBe(true);

    // 3. Login with new password
    const loginRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'account@example.com', password: 'newpassword123' },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it('lists active sessions and revokes a session', async () => {
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/account/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.statusCode).toBe(200);
    const sessions = listRes.json();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].device_name).toBe('Workstation');

    // Revoke session
    const tokenHash = sessions[0].token_hash;
    const deleteRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/account/sessions/${tokenHash}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(200);

    // Refresh token should now fail
    const refreshRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
  });

  it('exports user data as a ZIP archive', async () => {
    // Add some synced rows
    await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        changes: {
          books: [{ id: 'export-book-1', title: 'Export Book', updated_at: 100 }],
        },
      },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/account/export',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');
    // Verify payload is a ZIP (ZIP magic number PK\x03\x04 = 0x50 0x4b 0x03 0x04)
    expect(res.rawPayload[0]).toBe(0x50);
    expect(res.rawPayload[1]).toBe(0x4b);
  });

  it('deletes account and wipes data', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Subsequent login fails
    const loginRes = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'account@example.com', password: 'password123' },
    });
    expect(loginRes.statusCode).toBe(401);
  });
});
