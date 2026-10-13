import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

describe('Server Files API', () => {
  let ctx: TestContext;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ctx = await setupTestApp('files');

    const regA = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'filesA@example.com', password: 'password123' },
    });
    tokenA = regA.json().accessToken;

    const regB = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'filesB@example.com', password: 'password123' },
    });
    tokenB = regB.json().accessToken;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('rejects upload when sha256 hash does not match payload', async () => {
    const fakeHash = 'a'.repeat(64);
    const content = Buffer.from('hello world content');

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/files/${fakeHash}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/octet-stream',
      },
      payload: content,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('hash mismatch');
  });

  it('accepts upload with correct sha256 hash and allows download', async () => {
    const content = Buffer.from('The quick brown fox jumps over the lazy dog');
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');

    // 1. Upload
    const putRes = await ctx.app.inject({
      method: 'PUT',
      url: `/files/${actualHash}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/octet-stream',
      },
      payload: content,
    });

    expect(putRes.statusCode).toBe(201);
    expect(putRes.json().stored).toBe(true);
    expect(putRes.json().size).toBe(content.length);

    // 2. Download
    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/files/${actualHash}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.rawPayload).toEqual(content);
    expect(getRes.headers['content-length']).toBe(String(content.length));

    // 3. List
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/files',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listRes.statusCode).toBe(200);
    const files = listRes.json();
    expect(files).toHaveLength(1);
    expect(files[0].hash).toBe(actualHash);
    expect(files[0].size).toBe(content.length);

    // 4. Duplicate upload returns exists: true
    const dupRes = await ctx.app.inject({
      method: 'PUT',
      url: `/files/${actualHash}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/octet-stream',
      },
      payload: content,
    });
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().exists).toBe(true);
  });

  it('enforces tenant isolation: User B cannot access User A files', async () => {
    const content = Buffer.from('User A Private Secret File');
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');

    await ctx.app.inject({
      method: 'PUT',
      url: `/files/${actualHash}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/octet-stream',
      },
      payload: content,
    });

    // User B tries to read User A's file
    const getB = await ctx.app.inject({
      method: 'GET',
      url: `/files/${actualHash}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getB.statusCode).toBe(404);

    // User B lists files
    const listB = await ctx.app.inject({
      method: 'GET',
      url: '/files',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listB.json()).toHaveLength(0);
  });
});
