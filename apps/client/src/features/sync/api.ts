import {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getServerUrl,
  setAuthUser,
  clearAuth,
} from '../auth/storage';
import { setClockOffset } from '../../db';
import type {
  AuthResponse,
  SyncPushResponse,
  SyncPullResponse,
  EventsTokenResponse,
  SyncTableName,
} from '@folio/shared';

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
      const res = await fetch(`${serverUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        await clearAuth();
        throw new ApiError(res.status, await res.json().catch(() => null), 'Session expired');
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
      } catch {
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
    try {
      const newToken = await executeTokenRefresh();
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${serverUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body,
      });
    } catch (refreshErr) {
      await clearAuth();
      throw refreshErr;
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
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

export async function getFile(hash: string): Promise<Blob> {
  const serverUrl = await getServerUrl();
  let token = getAccessToken() || (await executeTokenRefresh());
  let res = await fetch(`${serverUrl}/files/${hash}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    token = await executeTokenRefresh();
    res = await fetch(`${serverUrl}/files/${hash}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!res.ok) {
    throw new ApiError(res.status, null, `Failed to download file ${hash}`);
  }
  return res.blob();
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
  await request('/account', { method: 'DELETE' });
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
