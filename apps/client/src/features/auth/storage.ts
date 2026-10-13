import { db } from '../../db';

let memoryAccessToken: string | null = null;

export const DEFAULT_SERVER_URL =
  import.meta.env.PROD
    ? (import.meta.env.VITE_SERVER_URL || 'https://ffxasce.duckdns.org')
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

export async function getServerUrl(): Promise<string> {
  const row = await db.kv.get('server_url');
  return typeof row?.value === 'string' ? row.value : DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  const normalized = url.trim().replace(/\/+$/, '');
  await db.kv.put({ key: 'server_url', value: normalized });
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
