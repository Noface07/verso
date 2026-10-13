import { z } from 'zod';
import type { TableRowMap, SyncTableName } from './sync-schema.js';

// Auth Request / Response Schemas
export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  deviceName: z.string().min(1).default('Browser'),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().min(1).default('Browser'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// Sync Push / Pull Contracts
export interface SyncChanges {
  books?: TableRowMap['books'][];
  progress?: TableRowMap['progress'][];
  annotations?: TableRowMap['annotations'][];
  collections?: TableRowMap['collections'][];
  collection_books?: TableRowMap['collection_books'][];
  reading_sessions?: TableRowMap['reading_sessions'][];
  settings?: TableRowMap['settings'][];
  series?: TableRowMap['series'][];
  chapter_progress?: TableRowMap['chapter_progress'][];
  sources?: TableRowMap['sources'][];
  devices?: TableRowMap['devices'][];
  [key: string]: unknown[] | undefined;
}

export const syncPushRequestSchema = z.object({
  changes: z.record(z.array(z.record(z.unknown()))),
});
export type SyncPushRequest = {
  changes: Partial<Record<SyncTableName, Record<string, unknown>[]>>;
};

export interface SyncPushResponse {
  accepted: number;
  stale: number;
  invalid: number;
  staleIds: Partial<Record<SyncTableName, string[]>>;
  serverTime: number;
}

export interface SyncPullResponse {
  changes: Partial<Record<SyncTableName, Record<string, unknown>[]>>;
  cursor: number;
  hasMore: boolean;
  serverTime: number;
}

export interface EventsTokenResponse {
  token: string;
  expiresIn: number;
}
