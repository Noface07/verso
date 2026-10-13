import Dexie, { type EntityTable } from 'dexie'

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
}

export interface SettingsRow extends Syncable {
  data: Record<string, unknown>
}

export interface FileRow { hash: string; blob: Blob }
export interface CoverRow { id: string; blob: Blob }
export interface KV { key: string; value: unknown }

export const db = new Dexie('folio') as Dexie & {
  books: EntityTable<Book, 'id'>
  progress: EntityTable<Progress, 'id'>
  annotations: EntityTable<Annotation, 'id'>
  collections: EntityTable<Collection, 'id'>
  collection_books: EntityTable<CollectionBook, 'id'>
  reading_sessions: EntityTable<ReadingSession, 'id'>
  settings: EntityTable<SettingsRow, 'id'>
  files: EntityTable<FileRow, 'hash'>
  covers: EntityTable<CoverRow, 'id'>
  kv: EntityTable<KV, 'key'>
}

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

export const SYNC_TABLES = [
  'books', 'progress', 'annotations', 'collections',
  'collection_books', 'reading_sessions', 'settings',
] as const

export const uid = () => crypto.randomUUID()
export const dirty = () => ({ updated_at: Date.now(), _dirty: 1 as const })

export function deviceId(): string {
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = uid()
    localStorage.setItem('device_id', id)
  }
  return id
}