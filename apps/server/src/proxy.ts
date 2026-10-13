import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import { pool } from './db.js';
import './types.js';

const STATIC_ALLOWED_HOSTS = new Set([
  'gutendex.com',
  'www.gutenberg.org',
  'gutenberg.org',
  'standardebooks.org',
  'api.mangadex.org',
  'uploads.mangadex.org',
  'openlibrary.org',
  'covers.openlibrary.org',
  'archive.org',
  'mangapill.com',
  'cdn.readdetectiveconan.com',
]);

function isStaticAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (STATIC_ALLOWED_HOSTS.has(host)) return true;
  if (host.endsWith('.mangadex.network')) return true;
  if (host.endsWith('.archive.org')) return true;
  return false;
}

// In-memory token bucket rate limiters per user
interface RateBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRatePerSec: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(key: string, maxTokens: number, refillRatePerSec: number): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now, maxTokens, refillRatePerSec };
    rateBuckets.set(key, bucket);
  }

  const elapsedSec = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsedSec * bucket.refillRatePerSec);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

// Clean up old rate buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) {
    if (now - bucket.lastRefill > 60000) {
      rateBuckets.delete(key);
    }
  }
}, 60000);

export const proxyRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get<{ Querystring: { url?: string } }>(
    '/',
    async (req, reply) => {
      const rawUrl = req.query?.url;
      if (!rawUrl || typeof rawUrl !== 'string') {
        return reply.code(400).send({ error: 'url parameter required' });
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return reply.code(400).send({ error: 'invalid url' });
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return reply.code(400).send({ error: 'only http and https supported' });
      }

      const hostname = parsed.hostname.toLowerCase();

      // Try verifying JWT if authorization header is provided
      let userId: string | null = null;
      if (req.headers.authorization) {
        try {
          await req.jwtVerify();
          userId = req.user.sub;
        } catch {
          // ignore invalid token for static allowed hosts, but don't grant user permissions
        }
      }

      // Rate limit checks:
      const rateLimitKey = userId ? `user:${userId}` : `ip:${req.ip}`;
      if (!checkRateLimit(`overall:${rateLimitKey}`, 10, 10)) {
        return reply.code(429).send({ error: 'overall proxy rate limit exceeded (10 req/s)' });
      }

      // 4 req/s for api.mangadex.org
      if (hostname === 'api.mangadex.org') {
        if (!checkRateLimit(`mangadex:${rateLimitKey}`, 4, 4)) {
          return reply.code(429).send({ error: 'mangadex proxy rate limit exceeded (4 req/s)' });
        }
      }

      // Check allowlist: static hosts first
      let isAllowed = isStaticAllowedHost(hostname);
      let isUserSourceHost = false;

      // Check user source hosts if not static allowed and user is authenticated
      if (!isAllowed && userId) {
        const sourcesRes = await pool.query<{ url: string }>(
          'select url from sources where user_id = $1 and deleted_at is null',
          [userId],
        );
        for (const row of sourcesRes.rows) {
          try {
            const sourceUrl = new URL(row.url);
            if (sourceUrl.hostname.toLowerCase() === hostname) {
              isAllowed = true;
              isUserSourceHost = true;
              break;
            }
          } catch {
            // ignore malformed source url
          }
        }
      }

      if (!isAllowed) {
        return reply.code(403).send({ error: `host not allowed: ${hostname}` });
      }

      // Construct forward headers
      const forwardHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      if (hostname === 'cdn.readdetectiveconan.com' || hostname.endsWith('mangapill.com')) {
        forwardHeaders['Referer'] = 'https://mangapill.com/';
      }

      if (req.headers.accept) {
        forwardHeaders['Accept'] = req.headers.accept;
      }
      if (req.headers.range) {
        forwardHeaders['Range'] = req.headers.range;
      }
      // Forward Authorization ONLY for user source hosts
      if (isUserSourceHost && req.headers.authorization) {
        forwardHeaders['Authorization'] = req.headers.authorization;
      }

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(parsed.toString(), {
          method: 'GET',
          headers: forwardHeaders,
          redirect: 'follow',
        });
      } catch (err: unknown) {
        const error = err as Error;
        return reply.code(502).send({ error: 'upstream fetch failed', message: error.message });
      }

      reply.code(upstreamRes.status);

      // Forward relevant headers
      const forwardableHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
        'cache-control',
      ];

      for (const h of forwardableHeaders) {
        const val = upstreamRes.headers.get(h);
        if (val) {
          reply.header(h, val);
        }
      }

      if (!upstreamRes.body) {
        return reply.send();
      }

      // Stream the body back
      const nodeStream = Readable.fromWeb(upstreamRes.body as import('node:stream/web').ReadableStream);
      return reply.send(nodeStream);
    },
  );
};

export default proxyRoutes;
