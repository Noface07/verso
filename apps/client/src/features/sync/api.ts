import {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getServerUrl,
  setAuthUser,
  getAuthUser,
  clearAuth,
} from '../auth/storage';
import { ACCOUNT_DELETED, STORAGE_OFFLINE } from '@verso/shared';
import { setClockOffset } from '../../db';
import type {
  AuthResponse,
  SyncPushResponse,
  SyncPullResponse,
  EventsTokenResponse,
  SyncTableName,
} from '@verso/shared';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(
    status: number,
    data: unknown,
    message?: string,
  ) {
    super(message || `API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** The server reports this account no longer exists (deleted on another device). */
export class AccountDeletedError extends ApiError {
  constructor(data: unknown) {
    super(401, data, 'This account was deleted.');
    this.name = 'AccountDeletedError';
  }
}

/** The server is up but can't reach the book file storage (s3rver PC / tunnel down). */
export class StorageOfflineError extends ApiError {
  constructor(data: unknown) {
    super(
      503,
      data,
      'Your book storage is offline. Start your storage (s3rver + ngrok) on your PC, then try again.',
    );
    this.name = 'StorageOfflineError';
  }
}

const isStorageOffline = (body: unknown) =>
  !!body && typeof body === 'object' && (body as { code?: unknown }).code === STORAGE_OFFLINE;

const isAccountDeleted = (body: unknown) =>
  !!body && typeof body === 'object' && (body as { code?: unknown }).code === ACCOUNT_DELETED;

let refreshPromise: Promise<string> | null = null;

export async function executeTokenRefresh(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) {
        throw new ApiError(401, null, 'No refresh token available');
      }

      const serverUrl = await getServerUrl();
      // The user id lets the server say "account deleted" even though deleting
      // the account also removed this refresh token.
      const user = await getAuthUser();
      const res = await fetch(`${serverUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, userId: user?.id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (isAccountDeleted(body)) throw new AccountDeletedError(body);
        // Only a real rejection ends the session. A 5xx (e.g. the server waking
        // from sleep) or a proxy error used to sign the user out silently.
        if (res.status === 401 || res.status === 403) {
          await clearAuth();
          throw new ApiError(res.status, body, 'Session expired');
        }
        throw new ApiError(res.status, body, `Server unavailable (${res.status}). Try again shortly.`);
      }

      const data: AuthResponse = await res.json();
      setAccessToken(data.accessToken);
      await setRefreshToken(data.refreshToken);
      await setAuthUser(data.user);
      return data.accessToken;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  auth?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const serverUrl = await getServerUrl();
  const requiresAuth = options.auth !== false;
  const headers: Record<string, string> = { ...options.headers };

  if (requiresAuth) {
    let token = getAccessToken();
    if (!token) {
      try {
        token = await executeTokenRefresh();
      } catch (err) {
        if (err instanceof AccountDeletedError) throw err;
        throw new ApiError(401, null, 'Authentication required');
      }
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(`${serverUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  // Handle 401 with single-flight token refresh and retry
  if (res.status === 401 && requiresAuth) {
    const body = await res.clone().json().catch(() => null);
    if (isAccountDeleted(body)) throw new AccountDeletedError(body);
    // executeTokenRefresh clears auth itself when the server rejects the session
    // (and only then; a temporarily unavailable server no longer signs you out).
    const newToken = await executeTokenRefresh();
    headers['Authorization'] = `Bearer ${newToken}`;
    res = await fetch(`${serverUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    if (res.status === 401 && isAccountDeleted(errorBody)) throw new AccountDeletedError(errorBody);
    if (res.status === 503 && isStorageOffline(errorBody)) throw new StorageOfflineError(errorBody);
    throw new ApiError(res.status, errorBody);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    // Update client clock offset if serverTime is present in response
    if (data && typeof data.serverTime === 'number') {
      setClockOffset(data.serverTime - Date.now());
    }
    return data as T;
  }

  return (res as unknown) as T;
}

// Auth API
export async function authRegister(
  email: string,
  password: string,
  deviceName: string = 'Browser',
): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceName }),
    auth: false,
  });
  setAccessToken(data.accessToken);
  await setRefreshToken(data.refreshToken);
  await setAuthUser(data.user);
  return data;
}

export async function authLogin(
  email: string,
  password: string,
  deviceName: string = 'Browser',
): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceName }),
    auth: false,
  });
  setAccessToken(data.accessToken);
  await setRefreshToken(data.refreshToken);
  await setAuthUser(data.user);
  return data;
}

export async function authLogout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    try {
      await request('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        auth: false,
      });
    } catch {
      // Ignore network errors on logout
    }
  }
  await clearAuth();
}

// Sync API
export async function syncPush(
  changes: Partial<Record<SyncTableName, Record<string, unknown>[]>>,
): Promise<SyncPushResponse> {
  return request<SyncPushResponse>('/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
}

export async function syncPull(since: number = 0): Promise<SyncPullResponse> {
  return request<SyncPullResponse>(`/sync/pull?since=${since}`);
}

export async function syncEventsToken(): Promise<EventsTokenResponse> {
  return request<EventsTokenResponse>('/sync/events-token', {
    method: 'POST',
  });
}

// Files API
export async function headFile(hash: string): Promise<boolean> {
  const serverUrl = await getServerUrl();
  const token = getAccessToken() || (await executeTokenRefresh().catch(() => null));
  if (!token) return false;

  const res = await fetch(`${serverUrl}/files/${hash}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status === 200;
}

export async function putFile(hash: string, blob: Blob): Promise<{ stored: boolean; size?: number }> {
  return request<{ stored: boolean; size?: number }>(`/files/${hash}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads a stored file and verifies it against its hash before returning it.
 * An unverified download (cut-off transfer, proxy error page) used to be saved
 * as the book and could then never open, and wiping the server never fixed it.
 */
export async function getFile(hash: string): Promise<Blob> {
  const serverUrl = await getServerUrl();
  // A sleeping free-tier server can take about a minute to answer.
  const fetchWithTimeout = async (token: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      return await fetch(`${serverUrl}/files/${hash}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await fetchWithTimeout(getAccessToken() || (await executeTokenRefresh()));
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => null);
    if (isAccountDeleted(body)) throw new AccountDeletedError(body);
    res = await fetchWithTimeout(await executeTokenRefresh());
  }

  if (!res.ok) {
    if (res.status === 503) {
      const body = await res.json().catch(() => null);
      if (isStorageOffline(body)) throw new StorageOfflineError(body);
    }
    throw new ApiError(
      res.status,
      null,
      res.status === 404 ? 'This book file is not on your server.' : `Failed to download file (${res.status})`,
    );
  }
  const blob = await res.blob();
  if ((await sha256Hex(blob)) !== hash) {
    throw new ApiError(422, null, 'The downloaded file was incomplete or corrupted. Try again.');
  }
  return blob;
}

export async function listFiles(): Promise<Array<{ hash: string; size: number }>> {
  return request<Array<{ hash: string; size: number }>>('/files');
}

// Account API
export interface AccountInfo {
  id: string;
  email: string;
  storageUsed: number;
  createdAt: string;
}

export async function getAccount(): Promise<AccountInfo> {
  return request<AccountInfo>('/account');
}

export async function patchPassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/account/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function deleteAccount(): Promise<void> {
  try {
    await request('/account', { method: 'DELETE' });
  } catch (err) {
    // Already deleted (e.g. from another device): that's the outcome we wanted.
    if (!(err instanceof AccountDeletedError)) throw err;
  }
  await clearAuth();
}

export interface SessionInfo {
  token_hash: string;
  device_name: string | null;
  created_at: string;
  expires_at: string;
}

export async function getSessions(): Promise<SessionInfo[]> {
  return request<SessionInfo[]>('/account/sessions');
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await request(`/account/sessions/${tokenHash}`, { method: 'DELETE' });
}
