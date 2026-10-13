import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  Download,
  Filter,
  ArrowUpDown,
  ExternalLink,
  RotateCw,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { db, dirty, now, uid, type Series, type ChapterProgress } from '../db';
import { getSourceById } from '../sources/registry';
import type { ChapterInfo, MangaSource, CatalogEntry } from '../sources/types';
import { safeHtml } from '../lib/safeHtml';
import { openExternalUrl } from '../lib/tauri';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { ProgressBar, ProgressRing } from '../design/components/Progress';

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & sort
  const [searchFilter, setSearchFilter] = useState('');
  const [hideRead, setHideRead] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [downloadingChapterId, setDownloadingChapterId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const seriesId = id || '';
  const sourceKind = seriesId.split(':')[0] || 'mangadex';

  // Live query for follow state
  const seriesRow = useLiveQuery(
    () => db.series.get(seriesId),
    [seriesId],
  );
  const isFollowed = Boolean(seriesRow && !seriesRow.deleted_at);

  // Live query for chapter progress
  const chapterProgressList = useLiveQuery(
    () => db.chapter_progress.filter((p) => p.series_id === seriesId && !p.deleted_at).toArray(),
    [seriesId],
  );

  const progressByChapterId = useMemo(() => {
    const map = new Map<string, ChapterProgress>();
    for (const p of chapterProgressList || []) {
      map.set(p.chapter_id, p);
    }
    return map;
  }, [chapterProgressList]);

  // Live query for downloaded chapter pages
  const downloadedPages = useLiveQuery(
    () => db.manga_pages.where('series_id').equals(seriesId).toArray(),
    [seriesId],
  );

  const downloadedChapterIds = useMemo(() => {
    const set = new Set<string>();
    for (const dp of downloadedPages || []) {
      set.add(dp.chapter_id);
    }
    return set;
  }, [downloadedPages]);

  // Load series details and chapter feed. Only the latest request may write state,
  // so a slow response for a previously opened series can't replace this one.
  const loadSeq = useRef(0);
  const loadData = useCallback(async () => {
    if (!seriesId) return;
    const ticket = ++loadSeq.current;
    const isCurrent = () => ticket === loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const source = await getSourceById(sourceKind);
      if (!source) {
        throw new Error(`Unsupported source: ${sourceKind}`);
      }

      const mangaSource = source as MangaSource;
      const [detailsData, chaptersData] = await Promise.all([
        mangaSource.details(seriesId),
        mangaSource.chapters(seriesId),
      ]);
      if (!isCurrent()) return;

      setEntry(detailsData);
      setChapters(chaptersData);
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [seriesId, sourceKind]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Toggle follow/unfollow in db.series
  const handleToggleFollow = async () => {
    if (!entry) return;
    if (isFollowed && seriesRow) {
      await db.series.update(seriesRow.id, {
        deleted_at: now(),
        ...dirty(),
      });
    } else {
      const existing = await db.series.get(seriesId);
      if (existing) {
        await db.series.update(seriesId, {
          deleted_at: null,
          title: entry.title,
          author: entry.authors.join(', ') || 'Unknown',
          cover_url: entry.cover,
          ...dirty(),
        });
      } else {
        const newSeries: Series = {
          id: seriesId,
          source: sourceKind,
          source_id: seriesId.replace(/^[^:]+:/, ''),
          title: entry.title,
          author: entry.authors.join(', ') || 'Unknown',
          cover_url: entry.cover,
          meta: {},
          added_at: now(),
          last_checked_at: now(),
          deleted_at: null,
          ...dirty(),
        };
        await db.series.put(newSeries);
      }
    }
  };

  // Mark all previous chapters as read
  const handleMarkPreviousRead = async (targetIndex: number) => {
    const chaptersToMark = chapters.slice(0, targetIndex + 1);
    for (const ch of chaptersToMark) {
      const existing = progressByChapterId.get(ch.id);
      if (existing) {
        await db.chapter_progress.update(existing.id, {
          read: true,
          read_at: now(),
          ...dirty(),
        });
      } else {
        const id = uid();
        const row: ChapterProgress = {
          id,
          series_id: seriesId,
          source: sourceKind,
          chapter_id: ch.id,
          chapter_number: ch.number,
          title: ch.title,
          page: 1,
          total_pages: 1,
          read: true,
          read_at: now(),
          deleted_at: null,
          ...dirty(),
        };
        await db.chapter_progress.put(row);
      }
    }
  };

  // Download chapter pages for offline reading
  const handleDownloadChapter = async (chapter: ChapterInfo) => {
    if (downloadingChapterId) return;
    setDownloadingChapterId(chapter.id);
    setDownloadProgress(0.1);

    try {
      const source = (await getSourceById(sourceKind)) as MangaSource;
      const pages = await source.pages(chapter.id);
      const total = pages.length;

      for (let i = 0; i < total; i++) {
        const p = pages[i];
        const res = await fetch(p.url);
        if (res.ok) {
          const blob = await res.blob();
          const pageId = `${seriesId}:${chapter.id}:${p.index}`;
          await db.manga_pages.put({
            id: pageId,
            series_id: seriesId,
            chapter_id: chapter.id,
            page: p.index,
            blob,
            created_at: Date.now(),
          });
        }
        setDownloadProgress(Math.min(0.99, (i + 1) / total));
      }
    } catch (err) {
      console.error('Failed to download chapter:', err);
    } finally {
      setDownloadingChapterId(null);
      setDownloadProgress(0);
    }
  };

  // Delete downloaded chapter pages
  const handleDeleteDownloadedChapter = async (chapterId: string) => {
    const pages = await db.manga_pages
      .where('[series_id+chapter_id]')
      .equals([seriesId, chapterId])
      .toArray();
    for (const p of pages) {
      await db.manga_pages.delete(p.id);
    }
  };

  // Continue or Start Reading
  // Only chapters MangaDex actually hosts can be read in the app; official
  // publisher releases (externalUrl) live on the publisher's site.
  const readableChapters = useMemo(() => chapters.filter((ch) => !ch.externalUrl), [chapters]);
  const firstUnreadChapter = useMemo(() => {
    return (
      readableChapters.find((ch) => !progressByChapterId.get(ch.id)?.read) || readableChapters[0]
    );
  }, [readableChapters, progressByChapterId]);

  const handleStartReading = () => {
    if (!firstUnreadChapter) return;
    navigate(`/read/manga/${encodeURIComponent(seriesId)}/${encodeURIComponent(firstUnreadChapter.id)}`);
  };

  // Filtered & sorted chapter list
  const visibleChapters = useMemo(() => {
    let list = [...chapters];
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      list = list.filter((c) => (c.title || '').toLowerCase().includes(q) || String(c.number).includes(q));
    }
    if (hideRead) {
      list = list.filter((c) => !progressByChapterId.get(c.id)?.read);
    }
    if (!sortAsc) {
      list.reverse();
    }
    return list;
  }, [chapters, searchFilter, hideRead, sortAsc, progressByChapterId]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-[var(--bg-base)]">
        <ProgressRing size={36} />
        <p className="text-sm text-[var(--text-3)] mt-3">Loading manga details…</p>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-[var(--bg-base)] p-6 text-center">
        <AlertCircle className="w-12 h-12 text-[var(--danger)] mb-3" />
        <h2 className="text-lg font-bold text-[var(--text-1)]">Failed to load series</h2>
        <p className="text-sm text-[var(--text-2)] mt-1 max-w-md">{error || 'Series not found'}</p>
        <div className="flex gap-3 mt-4">
          <Button variant="subtle" onClick={() => navigate(-1)}>
            Go Back
          </Button>
          <Button variant="standard" onClick={loadData}>
            <RotateCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[var(--bg-base)] select-none">
      {/* Top back navigation bar */}
      <div className="sticky top-0 z-30 px-6 py-3 chrome-surface border-b border-[var(--stroke)] flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-[var(--r-sm)] px-2 py-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="text-xs text-[var(--text-3)] uppercase tracking-wider font-semibold">
          {sourceKind}
        </div>
      </div>

      {/* Hero Banner with Ambient blurred cover background */}
      <div className="relative p-6 md:p-8 overflow-hidden border-b border-[var(--stroke)] bg-[var(--layer-1)]">
        {entry.cover && (
          <div
            className="absolute inset-0 bg-cover bg-center blur-2xl opacity-15 pointer-events-none scale-110"
            style={{ backgroundImage: `url(${entry.cover})` }}
          />
        )}

        <div className="relative z-10 flex flex-col md:flex-row gap-6 max-w-5xl mx-auto">
          {/* Cover image */}
          <div className="w-40 md:w-52 aspect-[2/3] shrink-0 rounded-[var(--r-cover)] overflow-hidden shadow-[var(--shadow-cover)] mx-auto md:mx-0">
            {entry.cover ? (
              <img
                src={entry.cover}
                alt={entry.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-[var(--layer-2)] flex items-center justify-center text-xs text-[var(--text-3)]">
                No Cover
              </div>
            )}
          </div>

          {/* Series Metadata & Actions */}
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold text-[var(--text-1)] leading-tight">
                {entry.title}
              </h1>
              <p className="text-sm font-medium text-[var(--text-2)] mt-1.5">
                {entry.authors.join(', ') || 'Unknown Author'}
              </p>

              {/* Tags */}
              {entry.tags && entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {entry.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--layer-3)] text-[var(--text-2)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              {entry.summary && (
                <div className="text-xs text-[var(--text-2)] leading-relaxed mt-4 max-h-36 overflow-y-auto pr-2">
                  {safeHtml(entry.summary)}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-[var(--stroke)]">
              {firstUnreadChapter && (
                <Button variant="accent" size="lg" onClick={handleStartReading}>
                  <BookOpen className="w-5 h-5 mr-2" />
                  {chapters.some((c) => progressByChapterId.get(c.id)?.read)
                    ? 'Continue Reading'
                    : 'Start Reading'}
                </Button>
              )}

              <Button
                variant={isFollowed ? 'standard' : 'subtle'}
                size="lg"
                onClick={handleToggleFollow}
              >
                {isFollowed ? (
                  <>
                    <BookmarkCheck className="w-5 h-5 mr-2 text-[var(--accent)]" />
                    Following
                  </>
                ) : (
                  <>
                    <Bookmark className="w-5 h-5 mr-2" />
                    Follow Series
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Chapters Section */}
      <div className="max-w-5xl mx-auto w-full px-6 py-6 flex-1 flex flex-col">
        {/* Controls: Search, Filter, Sort */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--stroke)]">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-[var(--text-1)]">
              Chapters ({chapters.length})
            </h2>
            <button
              type="button"
              onClick={() => setHideRead((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--r-md)] text-xs font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                hideRead
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--layer-2)] text-[var(--text-2)] hover:text-[var(--text-1)]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Hide Read
            </button>
            <button
              type="button"
              onClick={() => setSortAsc((prev) => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--r-md)] bg-[var(--layer-2)] text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortAsc ? 'Ascending' : 'Descending'}
            </button>
          </div>

          <div className="w-full sm:w-60">
            <input
              type="text"
              placeholder="Filter chapters…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full h-8 px-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Chapters List */}
        <div className="space-y-2">
          {!loading && !error && readableChapters.length === 0 && (
            <div className="p-4 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-2)] leading-relaxed">
              {chapters.length === 0
                ? 'MangaDex has no English chapters of this series. It is usually because the series is officially licensed and the publisher asked for them to be removed.'
                : 'This series is only available as official releases on the publisher’s site, so it can’t be read inside Folio. The chapters below open in your browser.'}
            </div>
          )}
          {visibleChapters.length === 0 ? (
            chapters.length > 0 && (
              <p className="text-center text-xs text-[var(--text-3)] py-12">
                No chapters match your filters.
              </p>
            )
          ) : (
            visibleChapters.map((ch, idx) => {
              const isRead = progressByChapterId.get(ch.id)?.read;
              const isDownloaded = downloadedChapterIds.has(ch.id);
              const isDownloading = downloadingChapterId === ch.id;

              return (
                <div
                  key={ch.id}
                  className={`group flex items-center justify-between p-3 rounded-[var(--r-md)] border transition-all ${
                    isRead
                      ? 'bg-[var(--layer-1)] border-[var(--stroke)] opacity-70'
                      : 'bg-[var(--layer-2)] border-[var(--stroke)] hover:border-[var(--stroke-strong)]'
                  }`}
                >
                  {/* Chapter title & group credit */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer pr-3"
                    onClick={() => {
                      if (ch.externalUrl) {
                        // Opening it in the app's own webview replaced Folio with the
                        // publisher's site and left no way back; use the system browser.
                        void openExternalUrl(ch.externalUrl);
                      } else {
                        navigate(
                          `/read/manga/${encodeURIComponent(seriesId)}/${encodeURIComponent(ch.id)}`,
                        );
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {isRead && <Check className="w-4 h-4 text-[var(--success)] shrink-0" />}
                      <span className="font-semibold text-sm text-[var(--text-1)] truncate group-hover:text-[var(--accent)] transition-colors">
                        {ch.title || `Chapter ${ch.number ?? ''}`}
                      </span>
                      {ch.externalUrl && (
                        <ExternalLink className="w-3.5 h-3.5 text-[var(--text-3)] shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-3)] mt-0.5 truncate">
                      {ch.externalUrl
                        ? 'Official release · opens on the publisher’s site'
                        : `Scanlation: ${ch.scanlationGroup || 'Unknown'} · Hosted on MangaDex`}
                    </div>
                  </div>

                  {/* Actions: Download & Mark as Read */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isDownloading ? (
                      <div className="w-20">
                        <ProgressBar value={downloadProgress * 100} height={4} />
                      </div>
                    ) : isDownloaded ? (
                      <IconButton
                        icon={<Trash2 className="w-4 h-4 text-[var(--text-3)] hover:text-[var(--danger)]" />}
                        label="Delete downloaded chapter"
                        variant="subtle"
                        size="sm"
                        onClick={() => handleDeleteDownloadedChapter(ch.id)}
                      />
                    ) : (
                      !ch.externalUrl && (
                        <IconButton
                          icon={<Download className="w-4 h-4" />}
                          label="Download chapter for offline reading"
                          variant="subtle"
                          size="sm"
                          onClick={() => handleDownloadChapter(ch)}
                        />
                      )
                    )}

                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => handleMarkPreviousRead(idx)}
                    >
                      {isRead ? 'Read' : 'Mark Read'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
