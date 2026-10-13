import { getServerUrl, getAccessToken, DEFAULT_SERVER_URL } from '../features/auth/storage';
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
// Hosts verified to send Access-Control-Allow-Origin, so a browser may call them
// directly. gutenberg.org and standardebooks.org do NOT (checked 2026-10-13): in a
// browser their files are only reachable through the signed-in server proxy.
const DIRECT_CORS_HOSTS = new Set([
  'gutendex.com',
  'api.mangadex.org',
  'uploads.mangadex.org',
  'openlibrary.org',
  'covers.openlibrary.org',
  'archive.org',
  'localhost',
  '127.0.0.1',
]);

function corsBlockedError(host: string): Error {
  return new Error(
    `${host} doesn't allow downloads directly from a web browser. Sign in to your Folio ` +
      'server (Settings → Account & Sync) so it can fetch the file for you, or use the ' +
      'desktop or Android app.',
  );
}

export async function netFetch(
  input: string | URL,
  init: NetFetchOptions = {},
): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : input.toString();
  const maxRetries = init.retries ?? 3;

  await rateLimiter.acquire(urlStr);

  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

  const isExternalHttp =
    urlStr.startsWith('http://') || urlStr.startsWith('https://');

  let fetchFn: typeof fetch = fetch;
  if (isTauri) {
    try {
      const tauriHttp = await import('@tauri-apps/plugin-http');
      if (tauriHttp && typeof tauriHttp.fetch === 'function') {
        fetchFn = tauriHttp.fetch as typeof fetch;
      }
    } catch {
      fetchFn = fetch;
    }
  }

  let targetUrl = urlStr;
  const headers = new Headers(init.headers);

  if (!isTauri && isExternalHttp) {
    const serverUrl = await getServerUrl();
    let serverHost = '';
    let targetHost = '';
    try {
      serverHost = new URL(serverUrl).hostname.toLowerCase();
      targetHost = new URL(urlStr).hostname.toLowerCase();
    } catch {
      // Ignore URL parse errors
    }

    let token = getAccessToken();
    if (!token) {
      try {
        token = await executeTokenRefresh();
      } catch {
        // Proceed without auth
      }
    }

    // Only route through /proxy if user is authenticated or targeting a non-CORS host
    if (serverHost && serverHost !== targetHost && (token || !DIRECT_CORS_HOSTS.has(targetHost))) {
      targetUrl = `${serverUrl}/proxy?url=${encodeURIComponent(urlStr)}`;
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
  }

  let attempt = 0;
  while (true) {
    try {
      const response = await fetchFn(targetUrl, {
        ...init,
        headers,
      });

      // If proxy failed with 401/403/502/404, fallback to direct fetch for external targets
      if (!response.ok && targetUrl !== urlStr && isExternalHttp) {
        try {
          const directRes = await fetchFn(urlStr, { ...init, headers: init.headers });
          if (directRes.ok) {
            return directRes;
          }
        } catch {
          // ignore fallback error and continue retry loop on response
        }
      }

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
      // If network fetch failed on proxy URL, attempt direct fetch as fallback
      if (targetUrl !== urlStr && isExternalHttp) {
        try {
          const directRes = await fetchFn(urlStr, { ...init, headers: init.headers });
          if (directRes.ok) {
            return directRes;
          }
        } catch {
          // continue to retry
        }
      }

      if ((err as Error)?.name === 'AbortError') throw err;
      // A browser fetch to a host without CORS fails identically every time; retrying
      // only added ~7s of backoff before the same "Failed to fetch".
      if (!isTauri && isExternalHttp && targetUrl === urlStr) {
        const host = new URL(urlStr).hostname.toLowerCase();
        if (!DIRECT_CORS_HOSTS.has(host)) throw corsBlockedError(host);
      }

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

export interface DownloadOptions {
  onProgress?: (fraction: number, received: number, total?: number) => void;
  signal?: AbortSignal;
  /** How many times to resume after the connection drops (default 8). */
  maxResumes?: number;
  headers?: HeadersInit;
}

/**
 * Downloads a file, resuming with HTTP Range requests when the connection drops.
 * Some hosts (gutenberg.org from parts of Asia, for example) stream at a few KB/s
 * and reset long transfers; restarting from zero meant large books never finished.
 */
export async function netDownload(url: string, opts: DownloadOptions = {}): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  let total: number | undefined;
  let contentType = '';
  let failures = 0;
  const maxResumes = opts.maxResumes ?? 8;

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
    const headers = new Headers(opts.headers);
    if (received > 0) headers.set('Range', `bytes=${received}-`);
    try {
      const res = await netFetch(url, { headers, signal: opts.signal, retries: 1 });
      if (received > 0 && res.status === 200) {
        // Server ignored the Range header: start over.
        chunks.length = 0;
        received = 0;
      } else if (!res.ok && res.status !== 206) {
        throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`.trim());
      }
      contentType ||= res.headers.get('content-type') ?? '';
      const range = res.headers.get('content-range');
      const len = Number(res.headers.get('content-length')) || undefined;
      total = range ? Number(range.split('/')[1]) || total : len !== undefined ? received + len : total;

      if (!res.body) {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        received += buf.byteLength;
      } else {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          opts.onProgress?.(total ? received / total : 0, received, total);
        }
      }
      if (total === undefined || received >= total) break;
      // Stream ended early without an error: resume from where it stopped.
      throw new Error('connection closed early');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || opts.signal?.aborted) throw err;
      if (++failures > maxResumes) {
        throw new Error(
          `Download kept failing after ${maxResumes} retries ` +
            `(${Math.round(received / 1024)} KB of ${total ? Math.round(total / 1024) + ' KB' : 'unknown'} received): ` +
            ((err as Error)?.message || String(err)),
          { cause: err },
        );
      }
      await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** failures)));
    }
  }
  opts.onProgress?.(1, received, total);
  return new Blob(chunks as BlobPart[], { type: contentType.split(';')[0] || undefined });
}

/** Size in bytes of a remote file without downloading it (undefined if unknown). */
export async function remoteSize(url: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    const res = await netFetch(url, { headers: { Range: 'bytes=0-0' }, signal, retries: 0 });
    const range = res.headers.get('content-range');
    await res.body?.cancel().catch(() => {});
    if (range) return Number(range.split('/')[1]) || undefined;
    return Number(res.headers.get('content-length')) || undefined;
  } catch {
    return undefined;
  }
}

/** Rewrite image URLs that reject third-party referers (like MangaPill CDN) to the local proxy */
export function proxyImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
  if (isTauri) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'cdn.readdetectiveconan.com' || host.endsWith('mangapill.com')) {
      return `${DEFAULT_SERVER_URL}/proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // Return original if invalid URL
  }
  return url;
}

export const net = {
  fetch: netFetch,
  download: netDownload,
  size: remoteSize,
  limiter: rateLimiter,
  proxyImageUrl,
};

