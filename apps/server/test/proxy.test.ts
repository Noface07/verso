import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestApp, type TestContext } from './test-helper.js';

describe('Server Proxy API', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await setupTestApp('proxy');

    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'proxy@example.com', password: 'password123' },
    });
    token = reg.json().accessToken;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx.cleanup();
  });

  it('rejects unauthorized/non-allowlisted hosts with 403', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/proxy?url=https://evil-unauthorized-site.com/data',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('host not allowed');
  });

  it('allows allowlisted static host (e.g. gutendex.com)', async () => {
    // Mock global fetch for upstream call
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ id: 1, title: 'Frankenstein' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/proxy?url=https://gutendex.com/books?search=Frankenstein',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].title).toBe('Frankenstein');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toBe('https://gutendex.com/books?search=Frankenstein');
  });

  it('allows user-configured custom source from sources table and forwards auth', async () => {
    // 1. Add user OPDS / Komga source to sources table
    await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        changes: {
          sources: [
            {
              id: 'my-custom-calibre',
              kind: 'opds1',
              name: 'My Calibre Server',
              url: 'https://my-private-calibre.net/opds',
              updated_at: Date.now(),
            },
          ],
        },
      },
    });

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<feed xmlns="http://www.w3.org/2005/Atom"><title>Calibre</title></feed>', {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      }),
    );

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/proxy?url=https://my-private-calibre.net/opds/catalog',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Calibre</title>');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
