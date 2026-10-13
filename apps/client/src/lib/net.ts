import { getServerUrl, getAccessToken } from '../features/auth/storage';
import { executeTokenRefresh } from '../features/sync/api';

export interface RateLimiterConfig {
  capacity: number;
  refillPerSec: number;
}

export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  getConfig(hostname: string): RateLimiterConfig {
    const host = hostname.toLowerCase();
    // At-home manga servers have 40 requests per minute limit
    if (host.endsWith('.mangadex.network') || host === 'uploads.mangadex.org') {
      return { capacity: 40, refillPerSec: 40 / 60 };
    }
    // MangaDex official API has 4 req/sec limit
    if (host === 'api.mangadex.org') {
      return { capacity: 4, refillPerSec: 4 };
    }
    // Default rate limit: 4 req/sec
    return { capacity: 4, refillPerSec: 4 };
  }

  async acquire(url: string): Promise<void> {
    let hostname = 'default';
    try {
      hostname = new URL(url).hostname;
    } catch {
      // Relative or invalid URL
    }

    const config = this.getConfig(hostname);
    const now = Date.now();
    let bucket = this.buckets.get(hostname);

    if (!bucket) {
      bucket = { tokens: config.capacity, lastRefill: now };
      this.buckets.set(hostname, bucket);
    } else {
      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(
        config.capacity,
        bucket.tokens + elapsedSec * config.refillPerSec,
      );
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Must wait for bucket to refill
    const needed = 1 - bucket.tokens;
    const waitMs = Math.ceil((needed / config.refillPerSec) * 1000);

    return new Promise((resolve) => {
      setTimeout(async () => {
        await this.acquire(url);
        resolve();
      }, Math.max( waitMs, 25 ));
    });
  }
}

export const rateLimiter = new TokenBucketLimiter();

export interface NetFetchOptions extends RequestInit {
  retries?: number;
}

/**
 * Universal net client that supports:
 * - Tauri native HTTP plugin or Web proxy routing
 * - Host-specific token bucket rate limiting
 * - Exponential backoff with jitter on 429/5xx and Retry-After support
 */
export async function netFetch(
  input: string | URL,
  init: NetFetchOptions = {},
): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : input.toString();
  const maxRetries = init.retries ?? 3;

  await rateLimiter.acquire(urlStr);

  let targetUrl = urlStr;
  const headers = new Headers(init.headers);

  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

  const isExternalHttp =
    urlStr.startsWith('http://') || urlStr.startsWith('https://');

  if (!isTauri && isExternalHttp) {
    const serverUrl = await getServerUrl();
    const serverHost = new URL(serverUrl).hostname;
    const targetHost = new URL(urlStr).hostname;

    // Route external calls through /proxy if targeting different host
    if (serverHost !== targetHost) {
      targetUrl = `${serverUrl}/proxy?url=${encodeURIComponent(urlStr)}`;
      let token = getAccessToken();
      if (!token) {
        try {
          token = await executeTokenRefresh();
        } catch {
          // Proceed without auth if refresh fails; proxy will handle or reject
        }
      }
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
  }

  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(targetUrl, {
        ...init,
        headers,
      });

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        attempt++;
        let delayMs = Math.pow(2, attempt) * 500 + Math.random() * 200;

        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const parsedSec = parseFloat(retryAfter);
          if (!isNaN(parsedSec)) {
            delayMs = parsedSec * 1000;
          } else {
            const dateParsed = Date.parse(retryAfter);
            if (!isNaN(dateParsed)) {
              delayMs = Math.max(0, dateParsed - Date.now());
            }
          }
        }

        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      return response;
    } catch (err) {
      if (attempt < maxRetries) {
        attempt++;
        const delayMs = Math.pow(2, attempt) * 500 + Math.random() * 200;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export const net = {
  fetch: netFetch,
  limiter: rateLimiter,
};
