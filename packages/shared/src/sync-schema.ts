import { z } from 'zod';

/**
 * Single source of truth for synced tables and their synced column names.
 * Defined in Folio Build Plan v2 section 3.1.
 */
export const SYNC_TABLES = {
  books: [
    'title',
    'author',
    'format',
    'file_hash',
    'file_size',
    'cover_hash',
    'meta',
    'added_at',
    'last_opened_at',
  ],
  progress: ['cfi', 'percent', 'chapter', 'device_id'],
  annotations: [
    'book_id',
    'type',
    'cfi',
    'text',
    'note',
    'color',
    'style',
    'chapter',
    'created_at',
  ],
  collections: ['name', 'sort_order', 'meta'],
  collection_books: ['collection_id', 'book_id'],
  reading_sessions: [
    'book_id',
    'started_at',
    'ended_at',
    'duration_sec',
    'start_percent',
    'end_percent',
    'words_read',
    'device_id',
    'kind',
  ],
  settings: ['data'],
  // New in Phase 3:
  series: [
    'source',
    'source_id',
    'title',
    'author',
    'cover_url',
    'status',
    'meta',
    'added_at',
    'last_read_at',
    'last_checked_at',
  ],
  chapter_progress: [
    'series_id',
    'source',
    'chapter_id',
    'chapter_number',
    'title',
    'page',
    'total_pages',
    'read',
    'read_at',
  ],
  sources: ['kind', 'name', 'url', 'meta', 'sort_order'],
  devices: ['name', 'platform', 'last_seen_at'],
} as const;

export type SyncTableName = keyof typeof SYNC_TABLES;

/**
 * Base columns present on every synced row.
 */
export const syncableSchema = z.object({
  id: z.string().min(1).max(128),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable().default(null),
  _dirty: z.union([z.literal(0), z.literal(1)]).optional(),
  server_seq: z.number().int().optional(),
});
export type Syncable = z.infer<typeof syncableSchema>;

// Books
export const bookMetaSchema = z.object({
  file_name: z.string().optional(),
  mime: z.string().optional(),
  language: z.string().optional(),
  publisher: z.string().optional(),
  description: z.string().optional(),
  series: z.string().optional(),
  word_count: z.number().optional(),
  paragraph_count: z.number().optional(),
  accent: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rating: z.number().min(0).max(5).optional(),
  finished_at: z.number().nullable().optional(),
  source: z
    .object({
      kind: z.string(),
      id: z.string(),
      url: z.string().optional(),
    })
    .optional(),
  kind: z.enum(['book', 'comic']).optional(),
}).passthrough();
export type BookMeta = z.infer<typeof bookMetaSchema>;

export const bookSchema = syncableSchema.extend({
  title: z.string(),
  author: z.string(),
  format: z.string(),
  file_hash: z.string(),
  file_size: z.number().int(),
  cover_hash: z.string().nullable().default(null),
  meta: bookMetaSchema.default({}),
  added_at: z.number().int(),
  last_opened_at: z.number().int().nullable().default(null),
});
export type Book = z.infer<typeof bookSchema>;

// Progress
export const progressSchema = syncableSchema.extend({
  cfi: z.string(),
  percent: z.number(),
  chapter: z.string().nullable().default(null),
  device_id: z.string(),
});
export type Progress = z.infer<typeof progressSchema>;

// Annotations
export const annotationTypeSchema = z.enum(['highlight', 'note', 'bookmark']);
export type AnnotationType = z.infer<typeof annotationTypeSchema>;

export const highlightStyleSchema = z.enum(['highlight', 'underline', 'strikethrough', 'squiggly']);
export type HighlightStyle = z.infer<typeof highlightStyleSchema>;

export const annotationSchema = syncableSchema.extend({
  book_id: z.string(),
  type: annotationTypeSchema,
  cfi: z.string(),
  text: z.string().default(''),
  note: z.string().default(''),
  color: z.string().default('#ffd43b'),
  style: highlightStyleSchema.default('highlight'),
  chapter: z.string().default(''),
  created_at: z.number().int(),
});
export type Annotation = z.infer<typeof annotationSchema>;

// Collections
export const collectionMetaSchema = z.object({
  icon: z.string().optional(),
  color: z.string().optional(),
  smart: z.record(z.unknown()).optional(),
}).passthrough();
export type CollectionMeta = z.infer<typeof collectionMetaSchema>;

export const collectionSchema = syncableSchema.extend({
  name: z.string(),
  sort_order: z.number().int().default(0),
  meta: collectionMetaSchema.default({}),
});
export type Collection = z.infer<typeof collectionSchema>;

// Collection Books
export const collectionBookSchema = syncableSchema.extend({
  collection_id: z.string(),
  book_id: z.string(),
});
export type CollectionBook = z.infer<typeof collectionBookSchema>;

// Reading Sessions
export const sessionKindSchema = z.enum(['book', 'manga']);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const readingSessionSchema = syncableSchema.extend({
  book_id: z.string(),
  started_at: z.number().int(),
  ended_at: z.number().int(),
  duration_sec: z.number().int(),
  start_percent: z.number(),
  end_percent: z.number(),
  words_read: z.number().int().default(0),
  device_id: z.string(),
  kind: sessionKindSchema.default('book'),
});
export type ReadingSession = z.infer<typeof readingSessionSchema>;

// Settings
export const settingsRowSchema = syncableSchema.extend({
  data: z.record(z.unknown()).default({}),
});
export type SettingsRow = z.infer<typeof settingsRowSchema>;

// Series (Manga / Comics)
export const seriesMetaSchema = z.object({
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  contentRating: z.string().optional(),
  lang: z.string().optional(),
  readingMode: z.string().optional(),
  unreadCount: z.number().optional(),
  latestChapterAt: z.number().optional(),
  groupPrefs: z.array(z.string()).optional(),
}).passthrough();
export type SeriesMeta = z.infer<typeof seriesMetaSchema>;

export const seriesSchema = syncableSchema.extend({
  source: z.string(),
  source_id: z.string(),
  title: z.string(),
  author: z.string().default(''),
  cover_url: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  meta: seriesMetaSchema.default({}),
  added_at: z.number().int(),
  last_read_at: z.number().int().nullable().default(null),
  last_checked_at: z.number().int().nullable().default(null),
});
export type Series = z.infer<typeof seriesSchema>;

// Chapter Progress
export const chapterProgressSchema = syncableSchema.extend({
  series_id: z.string(),
  source: z.string(),
  chapter_id: z.string(),
  chapter_number: z.number(),
  title: z.string().nullable().default(null),
  page: z.number().int().default(0),
  total_pages: z.number().int().default(0),
  read: z.boolean().default(false),
  read_at: z.number().int().nullable().default(null),
});
export type ChapterProgress = z.infer<typeof chapterProgressSchema>;

// Sources (OPDS / Komga / Kavita catalogs)
export const sourceMetaSchema = z.object({
  type: z.enum(['opds1', 'opds2', 'komga', 'kavita']).optional(),
  authKind: z.enum(['none', 'basic', 'apikey']).optional(),
}).passthrough();
export type SourceMeta = z.infer<typeof sourceMetaSchema>;

export const sourceSchema = syncableSchema.extend({
  kind: z.string(),
  name: z.string(),
  url: z.string(),
  meta: sourceMetaSchema.default({}),
  sort_order: z.number().int().default(0),
});
export type Source = z.infer<typeof sourceSchema>;

// Devices
export const deviceSchema = syncableSchema.extend({
  name: z.string(),
  platform: z.string(),
  last_seen_at: z.number().int(),
});
export type Device = z.infer<typeof deviceSchema>;

/**
 * Mapping of each table name to its row schema.
 */
export const TABLE_SCHEMAS = {
  books: bookSchema,
  progress: progressSchema,
  annotations: annotationSchema,
  collections: collectionSchema,
  collection_books: collectionBookSchema,
  reading_sessions: readingSessionSchema,
  settings: settingsRowSchema,
  series: seriesSchema,
  chapter_progress: chapterProgressSchema,
  sources: sourceSchema,
  devices: deviceSchema,
} as const;

export type TableRowMap = {
  books: Book;
  progress: Progress;
  annotations: Annotation;
  collections: Collection;
  collection_books: CollectionBook;
  reading_sessions: ReadingSession;
  settings: SettingsRow;
  series: Series;
  chapter_progress: ChapterProgress;
  sources: Source;
  devices: Device;
};

/**
 * Validates that row conforms to the table schema.
 */
export function validateRow<T extends SyncTableName>(table: T, data: unknown): TableRowMap[T] {
  const schema = TABLE_SCHEMAS[table];
  return schema.parse(data) as TableRowMap[T];
}
