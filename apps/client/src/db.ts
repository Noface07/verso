import Dexie, { type EntityTable } from 'dexie'
import { SYNC_TABLES as SHARED_SYNC_TABLES, type SyncTableName } from '@verso/shared'

export interface Syncable {
  id: string
  updated_at: number
  deleted_at: number | null
  _dirty: 0 | 1
}

export interface BookMeta {
  file_name: string
  mime: string
  language?: string
  publisher?: string
  description?: string
  series?: string
  word_count?: number
  paragraph_count?: number
  accent?: string
  tags?: string[]
  rating?: number
  finished_at?: number | null
  series_number?: number
  favorite?: boolean
  source?: {
    kind: string
    id: string
    url?: string
  }
  kind?: 'book' | 'comic'
}

export interface Book extends Syncable {
  title: string
  author: string
  format: string
  file_hash: string
  file_size: number
  cover_hash: string | null
  meta: BookMeta
  added_at: number
  last_opened_at: number | null
}

export interface Progress extends Syncable {
  cfi: string
  percent: number
  chapter: string | null
  device_id: string
}

export type AnnotationType = 'highlight' | 'note' | 'bookmark'
export type HighlightStyle = 'highlight' | 'underline' | 'strikethrough' | 'squiggly'

export interface Annotation extends Syncable {
  book_id: string
  type: AnnotationType
  cfi: string
  text: string
  note: string
  color: string
  style: HighlightStyle
  chapter: string
  created_at: number
}

export interface Collection extends Syncable {
  name: string
  sort_order: number
  meta?: Record<string, unknown>
}

export interface CollectionBook extends Syncable {
  collection_id: string
  book_id: string
}

export interface ReadingSession extends Syncable {
  book_id: string
  started_at: number
  ended_at: number
  duration_sec: number
  start_percent: number
  end_percent: number
  words_read: number
  device_id: string
  kind?: string
}

export interface SettingsRow extends Syncable {
  data: Record<string, unknown>
}

export interface Series extends Syncable {
  source: string
  source_id: string
  title: string
  author?: string
  cover_url?: string
  status?: string
  meta: Record<string, unknown>
  added_at?: number
  last_read_at?: number
  last_checked_at?: number
}

export interface ChapterProgress extends Syncable {
  series_id: string
  source: string
  chapter_id: string
  chapter_number?: number
  title?: string
  page?: number
  total_pages?: number
  read: boolean
  read_at?: number
}

export interface Source extends Syncable {
  kind: string
  name: string
  url: string
  meta: Record<string, unknown>
  sort_order: number
}

export interface Device extends Syncable {
  name: string
  platform: string
  last_seen_at?: number
}

export interface FileRow { hash: string; blob: Blob }
export interface CoverRow { id: string; blob: Blob }
export interface KV { key: string; value: unknown }

export interface DownloadItem {
  id: string
  kind: 'book' | 'manga'
  source: string
  title: string
  url: string
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  progress: number
  error?: string
  created_at: number
  entry?: Record<string, unknown>
}

export interface SourceCredential {
  id: string
  username?: string
  password?: string
  apiKey?: string
}

export interface CatalogCacheItem {
  key: string
  data: unknown
  expires_at: number
}

export interface MangaPageRow {
  id: string
  series_id: string
  chapter_id: string
  page: number
  blob: Blob
  created_at: number
}

export const db = new Dexie('folio') as Dexie & {
  books: EntityTable<Book, 'id'>
  progress: EntityTable<Progress, 'id'>
  annotations: EntityTable<Annotation, 'id'>
  collections: EntityTable<Collection, 'id'>
  collection_books: EntityTable<CollectionBook, 'id'>
  reading_sessions: EntityTable<ReadingSession, 'id'>
  settings: EntityTable<SettingsRow, 'id'>
  series: EntityTable<Series, 'id'>
  chapter_progress: EntityTable<ChapterProgress, 'id'>
  sources: EntityTable<Source, 'id'>
  devices: EntityTable<Device, 'id'>
  files: EntityTable<FileRow, 'hash'>
  covers: EntityTable<CoverRow, 'id'>
  kv: EntityTable<KV, 'key'>
  downloads: EntityTable<DownloadItem, 'id'>
  source_credentials: EntityTable<SourceCredential, 'id'>
  catalog_cache: EntityTable<CatalogCacheItem, 'key'>
  manga_pages: EntityTable<MangaPageRow, 'id'>
}

// Version 1: initial tables
db.version(1).stores({
  books: 'id, title, author, added_at, last_opened_at, _dirty',
  progress: 'id, _dirty',
  annotations: 'id, book_id, type, _dirty',
  collections: 'id, _dirty',
  collection_books: 'id, collection_id, book_id, _dirty',
  reading_sessions: 'id, book_id, started_at, _dirty',
  settings: 'id, _dirty',
  files: 'hash',
  covers: 'id',
  kv: 'key',
})

// Version 2: manga, series, sources, devices
db.version(2).stores({
  books: 'id, title, author, added_at, last_opened_at, _dirty',
  progress: 'id, _dirty',
  annotations: 'id, book_id, type, _dirty',
  collections: 'id, _dirty',
  collection_books: 'id, collection_id, book_id, _dirty',
  reading_sessions: 'id, book_id, started_at, _dirty',
  settings: 'id, _dirty',
  series: 'id, source, title, last_read_at, _dirty',
  chapter_progress: 'id, series_id, source, _dirty',
  sources: 'id, kind, _dirty',
  devices: 'id, _dirty',
  files: 'hash',
  covers: 'id',
  kv: 'key',
})

// Version 3: client-only tables (downloads, catalog_cache, source_credentials)
db.version(3).stores({
  downloads: 'id, source, status, created_at',
  catalog_cache: 'key, expires_at',
  source_credentials: 'id',
})

// Version 4: client-only manga offline pages
db.version(4).stores({
  manga_pages: 'id, series_id, chapter_id, [series_id+chapter_id]',
})

// Version 5: hot query compound indexes for annotations, sessions, and chapter progress
db.version(5).stores({
  annotations: 'id, book_id, type, created_at, [book_id+type], _dirty',
  reading_sessions: 'id, book_id, started_at, [book_id+started_at], _dirty',
  chapter_progress: 'id, series_id, source, [series_id+read], [series_id+chapter_number], _dirty',
})

export const SYNC_TABLES = Object.keys(SHARED_SYNC_TABLES) as SyncTableName[]

export const uid = () => crypto.randomUUID()

let clockOffset = 0
export function setClockOffset(offset: number) {
  clockOffset = offset
  db.kv.put({ key: 'clock_offset', value: offset }).catch(() => {})
}
export function getClockOffset(): number {
  return clockOffset
}

// Restore cached clock offset on initialization
db.kv.get('clock_offset').then((row) => {
  if (row && typeof row.value === 'number') {
    clockOffset = row.value
  }
}).catch(() => {})

export const now = () => Date.now() + clockOffset
export const dirty = () => ({ updated_at: now(), _dirty: 1 as const })

export function deviceId(): string {
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = uid()
    localStorage.setItem('device_id', id)
  }
  return id
}