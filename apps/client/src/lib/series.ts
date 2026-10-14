import { db, dirty, now, type Series } from '../db'
import type { CatalogEntry } from '../sources/types'

/**
 * A series row means "Verso knows this series" (it was followed or read). Following
 * is `meta.followed`; rows written before that flag existed were only ever created
 * by following, so a missing flag counts as followed.
 */
export function isFollowedSeries(s: Series | null | undefined): boolean {
  return !!s && !s.deleted_at && s.meta?.followed !== false
}

/**
 * Records that a series was read just now, creating its row (not followed) if
 * needed, so it shows up in reading history even when it isn't followed.
 */
export async function recordSeriesRead(
  seriesId: string,
  source: string,
  loadEntry: () => Promise<CatalogEntry | null>,
): Promise<void> {
  const existing = await db.series.get(seriesId)
  if (existing) {
    await db.series.update(seriesId, {
      last_read_at: now(),
      // A previously unfollowed (soft-deleted) series comes back as history only.
      ...(existing.deleted_at ? { deleted_at: null, meta: { ...existing.meta, followed: false } } : {}),
      ...dirty(),
    })
    return
  }
  const entry = await loadEntry().catch(() => null)
  const row: Series = {
    id: seriesId,
    source,
    source_id: seriesId.replace(/^[^:]+:/, ''),
    title: entry?.title ?? 'Unknown series',
    author: entry?.authors.join(', ') || '',
    cover_url: entry?.cover,
    meta: { followed: false },
    added_at: now(),
    last_read_at: now(),
    deleted_at: null,
    ...dirty(),
  }
  // Another write may have created it while details were loading.
  if (!(await db.series.get(seriesId))) await db.series.put(row)
}

/** Follow or unfollow, keeping the row (and so the reading history) either way. */
export async function setSeriesFollowed(
  seriesId: string,
  source: string,
  entry: CatalogEntry,
  followed: boolean,
): Promise<void> {
  const existing = await db.series.get(seriesId)
  const details = {
    title: entry.title,
    author: entry.authors.join(', ') || 'Unknown',
    cover_url: entry.cover,
  }
  if (existing) {
    await db.series.update(seriesId, {
      ...details,
      deleted_at: null,
      meta: { ...existing.meta, followed },
      ...(followed ? { last_checked_at: now() } : {}),
      ...dirty(),
    })
    return
  }
  await db.series.put({
    id: seriesId,
    source,
    source_id: seriesId.replace(/^[^:]+:/, ''),
    ...details,
    meta: { followed },
    added_at: now(),
    last_checked_at: now(),
    deleted_at: null,
    ...dirty(),
  })
}

export interface MangaBookmark {
  chapterId: string
  chapterTitle: string
  page: number
  createdAt: number
}

export function getMangaBookmarks(s: Series | null | undefined): MangaBookmark[] {
  const list = s?.meta?.bookmarks
  return Array.isArray(list) ? (list as MangaBookmark[]) : []
}

export function isMangaPageBookmarked(s: Series | null | undefined, chapterId: string, page: number): boolean {
  return getMangaBookmarks(s).some((b) => b.chapterId === chapterId && b.page === page)
}

/** Adds or removes a page bookmark. Bookmarks sync with the series row. */
export async function toggleMangaBookmark(
  seriesId: string,
  source: string,
  mark: Omit<MangaBookmark, 'createdAt'>,
): Promise<void> {
  // A bookmark implies the series is in history; make sure the row exists.
  if (!(await db.series.get(seriesId))) await recordSeriesRead(seriesId, source, async () => null)
  const row = await db.series.get(seriesId)
  if (!row) return
  const list = getMangaBookmarks(row)
  const exists = list.some((b) => b.chapterId === mark.chapterId && b.page === mark.page)
  const next = exists
    ? list.filter((b) => !(b.chapterId === mark.chapterId && b.page === mark.page))
    : [...list, { ...mark, createdAt: now() }]
  await db.series.update(seriesId, { meta: { ...row.meta, bookmarks: next }, ...dirty() })
}

/**
 * Clears manga reading history: series that were only read (not in the library)
 * are removed, library series keep their place but lose their "last read" time.
 * Chapter read marks are kept so unread counts stay correct.
 */
export async function clearMangaHistory(): Promise<number> {
  const rows = await db.series.filter((s) => !s.deleted_at && !!s.last_read_at).toArray()
  await db.transaction('rw', db.series, async () => {
    for (const s of rows) {
      if (isFollowedSeries(s)) await db.series.update(s.id, { last_read_at: undefined, ...dirty() })
      else await db.series.update(s.id, { deleted_at: now(), ...dirty() })
    }
  })
  return rows.length
}

/** Removes one series from reading history (a library series stays in the library). */
export async function removeFromMangaHistory(seriesId: string): Promise<void> {
  const s = await db.series.get(seriesId)
  if (!s) return
  if (isFollowedSeries(s)) await db.series.update(seriesId, { last_read_at: undefined, ...dirty() })
  else await db.series.update(seriesId, { deleted_at: now(), ...dirty() })
}

