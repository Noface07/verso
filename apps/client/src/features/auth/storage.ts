import { db } from '../../db';

let memoryAccessToken: string | null = null;

export const DEFAULT_SERVER_URL =
  import.meta.env.PROD
    ? (import.meta.env.VITE_SERVER_URL || 'https://verso-6epp.onrender.com')
    : (import.meta.env.VITE_SERVER_URL || 'http://localhost:8080');

export interface StoredUser {
  id: string;
  email: string;
}

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

export async function getRefreshToken(): Promise<string | null> {
  const row = await db.kv.get('refresh_token');
  return typeof row?.value === 'string' ? row.value : null;
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (token) {
    await db.kv.put({ key: 'refresh_token', value: token });
  } else {
    await db.kv.delete('refresh_token');
  }
}

/**
 * Validates and normalises a Verso server address. Returns an error message for
 * values that can't work, notably a database address: the app talks to the Verso
 * API, and only the API talks to Postgres/Supabase.
 */
export function normalizeServerUrl(input: string): { url: string } | { error: string } {
  let raw = input.trim().replace(/\/+$/, '');
  if (!raw) return { error: 'Enter the address of your Verso server.' };
  if (/^postgres(ql)?:/i.test(raw)) {
    return {
      error:
        'That is a database connection string. Enter the Verso server address instead (for example https://verso.example.com).',
    };
  }
  if (!/^https?:\/\//i.test(raw)) {
    const local = /^(localhost|127\.|10\.|192\.168\.)/.test(raw);
    raw = `${local ? 'http' : 'https'}://${raw}`;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'That does not look like a web address.' };
  }
  if (/supabase\.(co|com)$/i.test(u.hostname) || u.port === '5432' || u.port === '6543') {
    return {
      error:
        'That is the Supabase database address. The app connects to the Verso API server, which then talks to Supabase (for example http://localhost:8080 or your deployed server).',
    };
  }
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

export async function getServerUrl(): Promise<string> {
  const row = await db.kv.get('server_url');
  if (typeof row?.value !== 'string') return DEFAULT_SERVER_URL;
  if (row.value.includes('duckdns.org')) {
    await db.kv.delete('server_url');
    return DEFAULT_SERVER_URL;
  }
  // Ignore a previously saved unusable value (e.g. a database address).
  const checked = normalizeServerUrl(row.value);
  return 'url' in checked ? checked.url : DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  const checked = normalizeServerUrl(url);
  if ('error' in checked) throw new Error(checked.error);
  await db.kv.put({ key: 'server_url', value: checked.url });
}

/** Forget a custom server and use the address built into the app. */
export async function resetServerUrl(): Promise<void> {
  await db.kv.delete('server_url');
}

export async function getAuthUser(): Promise<StoredUser | null> {
  const row = await db.kv.get('auth_user');
  if (row?.value && typeof row.value === 'object') {
    const u = row.value as Record<string, unknown>;
    if (typeof u.id === 'string' && typeof u.email === 'string') {
      return { id: u.id, email: u.email };
    }
  }
  return null;
}

export async function setAuthUser(user: StoredUser | null): Promise<void> {
  if (user) {
    await db.kv.put({ key: 'auth_user', value: user });
  } else {
    await db.kv.delete('auth_user');
  }
}

export async function clearAuth(): Promise<void> {
  memoryAccessToken = null;
  await Promise.all([
    db.kv.delete('refresh_token'),
    db.kv.delete('auth_user'),
  ]);
}
