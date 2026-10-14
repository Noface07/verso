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
  Images,
  X,
  Heart,
} from 'lucide-react';
import { db, dirty, now, uid, type ChapterProgress } from '../db';
import { getSourceById } from '../sources/registry';
import { isAdultRating, type ChapterInfo, type MangaSource, type CatalogEntry, type PageRef } from '../sources/types';
import { net } from '../lib/net';
import { safeHtml } from '../lib/safeHtml';
import { openInAppWindow } from '../lib/tauri';
import { toggleFavorite, useFavoriteIds } from '../lib/favourites';
import { getMangaBookmarks, isFollowedSeries, setSeriesFollowed, toggleMangaBookmark } from '../lib/series';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { ProgressBar, ProgressRing } from '../design/components/Progress';

// Last state per series, so coming back from the reader shows the page instantly
// at the same tab and scroll position instead of refetching and jumping to the top.
const seriesViewCache = new Map<
  string,
  { entry: CatalogEntry; chapters: ChapterInfo[]; view: 'chapters' | 'pages'; scrollTop: number }
>();

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cached = seriesViewCache.get(id || '');
  const rootRef = useRef<HTMLDivElement>(null);

  const [entry, setEntry] = useState<CatalogEntry | null>(cached?.entry ?? null);
  const [chapters, setChapters] = useState<ChapterInfo[]>(cached?.chapters ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  // Filter & sort
  const [searchFilter, setSearchFilter] = useState('');
  const [hideRead, setHideRead] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  // Phones get a compact header: smaller buttons and fewer tags until expanded.
  const compact = typeof window !== 'undefined' && window.innerWidth < 640;
  const tagLimit = compact ? 5 : 10;
  const [tagsExpanded, setTagsExpanded] = useState(false);
  // Chapters list, or every chapter's pages in one scrolling list. Browsing pages
  // does not touch reading progress or history; only opening one in the reader does.
  const [view, setView] = useState<'chapters' | 'pages'>(cached?.view ?? 'chapters');
  const [activePageChapter, setActivePageChapter] = useState<string | null>(null);
  const chapterNavRef = useRef<HTMLElement>(null);
  const [downloadingChapterId, setDownloadingChapterId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const seriesId = id || '';
  const sourceKind = seriesId.split(':')[0] || 'mangadex';

  // Live query for follow state
  const seriesRow = useLiveQuery(
    () => db.series.get(seriesId),
    [seriesId],
  );
  const isFollowed = isFollowedSeries(seriesRow);

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
    // With a cached copy on screen, refresh quietly in the background.
    if (!seriesViewCache.has(seriesId)) setLoading(true);
    setError(null);
    try {
      const source = (await getSourceById(seriesId)) || (await getSourceById(sourceKind));
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

  const scrollPos = useRef(cached?.scrollTop ?? 0);
  const latestView = useRef({ entry, chapters, view });
  latestView.current = { entry, chapters, view };
  useEffect(() => {
    const el = rootRef.current;
    if (el && cached?.scrollTop) el.scrollTop = cached.scrollTop;
    return () => {
      const { entry: e, chapters: c, view: v } = latestView.current;
      if (e) seriesViewCache.set(seriesId, { entry: e, chapters: c, view: v, scrollTop: scrollPos.current });
    };
    // Mount/unmount per series only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  // Toggle follow/unfollow in db.series
  const favIds = useFavoriteIds();
  const isFavourite = favIds.has(seriesId);
  const handleToggleFavourite = async () => {
    await toggleFavorite(seriesId, isFavourite);
    // A favourite belongs in the manga library.
    if (!isFavourite && !isFollowed && entry) await setSeriesFollowed(seriesId, sourceKind, entry, true);
  };

  const handleToggleFollow = async () => {
    if (!entry) return;
    // Unfollowing keeps the row so the series stays in reading history.
    await setSeriesFollowed(seriesId, sourceKind, entry, !isFollowed);
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
      const source = ((await getSourceById(seriesId)) || (await getSourceById(sourceKind))) as MangaSource;
      const pages = await source.pages(chapter.id);
      const total = pages.length;

      for (let i = 0; i < total; i++) {
        const p = pages[i];
        const res = await net.fetch(p.url);
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

  const openChapterAt = (chapterId: string, page?: number) =>
    navigate(
      `/read/manga/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterId)}${page ? `?page=${page}` : ''}`,
    );

  const bookmarks = getMangaBookmarks(seriesRow);

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

  const pageChapters = useMemo(() => visibleChapters.filter((c) => !c.externalUrl), [visibleChapters]);
  // Before any scrolling there is no observed section yet: highlight the first.
  const currentPageChapter = activePageChapter ?? pageChapters[0]?.id ?? null;

  // Jump (not smooth): smooth-scrolling past dozens of chapters would make each
  // of them start loading its pages on the way.
  const jumpToChapter = (chapterId: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-chapter-id="${CSS.escape(chapterId)}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
    setActivePageChapter(chapterId);
  };

  // Scroll-spy: the chapter crossing the upper third of the viewport is active.
  useEffect(() => {
    const root = rootRef.current;
    if (view !== 'pages' || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        const id = hit?.target.getAttribute('data-chapter-id');
        if (id) setActivePageChapter(id);
      },
      { root, rootMargin: '-25% 0px -70% 0px' },
    );
    root.querySelectorAll('[data-chapter-id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [view, pageChapters]);

  // Opening the Pages view starts at the first unread chapter.
  const firstUnreadId = firstUnreadChapter?.id;
  useEffect(() => {
    if (view !== 'pages' || !firstUnreadId || firstUnreadId === pageChapters[0]?.id) return;
    const t = requestAnimationFrame(() => jumpToChapter(firstUnreadId));
    return () => cancelAnimationFrame(t);
    // Only when switching into the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Keep the active chapter centred in the sidebar, like synced lyrics.
  useEffect(() => {
    const nav = chapterNavRef.current;
    const item = activePageChapter
      ? nav?.querySelector<HTMLElement>(`[data-nav-chapter="${CSS.escape(activePageChapter)}"]`)
      : null;
    if (!nav || !item) return;
    nav.scrollTo({ top: item.offsetTop - nav.clientHeight / 2 + item.offsetHeight / 2, behavior: 'smooth' });
  }, [activePageChapter]);


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
    <div
      ref={rootRef}
      onScroll={(e) => {
        scrollPos.current = e.currentTarget.scrollTop;
      }}
      className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden bg-[var(--bg-base)] select-none"
    >
      {/* Top back navigation bar */}
      <div className="sticky top-0 z-30 shrink-0 px-4 sm:px-6 py-3 chrome-surface border-b border-[var(--stroke)] flex items-center justify-between">
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
      {/* shrink-0: as a child of the scrolling flex column it used to shrink to the
          viewport and its overflow-hidden cut off the title and details. */}
      <div className="relative shrink-0 p-3 sm:p-6 md:p-8 overflow-hidden border-b border-[var(--stroke)] bg-[var(--layer-1)]">
        {entry.cover && (
          <div
            className="absolute inset-0 bg-cover bg-center blur-2xl opacity-15 pointer-events-none scale-110"
            style={{ backgroundImage: `url(${entry.cover})` }}
          />
        )}

        <div className="relative z-10 flex flex-row flex-wrap md:flex-nowrap gap-4 md:gap-6 max-w-5xl mx-auto">
          {/* Cover image */}
          <div className="w-24 sm:w-36 md:w-52 aspect-[2/3] shrink-0 self-start rounded-[var(--r-cover)] overflow-hidden shadow-[var(--shadow-cover)]">
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
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              <h1 className="text-lg sm:text-2xl md:text-3xl font-display font-bold text-[var(--text-1)] leading-tight [overflow-wrap:anywhere]">
                {entry.title}
              </h1>
              <p className="text-xs sm:text-sm font-medium text-[var(--text-2)] mt-1 sm:mt-1.5 truncate">
                {entry.authors.join(', ') || 'Unknown Author'}
              </p>

              {/* Facts row */}
              <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mt-2 sm:mt-3 text-[10px] sm:text-[11px] font-semibold">
                {isAdultRating(entry.contentRating) && (
                  <span className="px-2 py-0.5 rounded-[var(--r-sm)] bg-[var(--danger)] text-white">18+</span>
                )}
                {entry.contentRating === 'suggestive' && (
                  <span className="px-2 py-0.5 rounded-[var(--r-sm)] bg-[var(--warning)]/20 text-[var(--warning)]">Suggestive</span>
                )}
                {entry.status && (
                  <span
                    className={`px-2 py-0.5 rounded-[var(--r-sm)] capitalize ${
                      entry.status === 'completed'
                        ? 'bg-[var(--success-soft)] text-[var(--success)]'
                        : 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    }`}
                  >
                    {entry.status}
                  </span>
                )}
                {entry.demographic && (
                  <span className="px-2 py-0.5 rounded-[var(--r-sm)] bg-[var(--layer-3)] text-[var(--text-2)] capitalize">
                    {entry.demographic}
                  </span>
                )}
                {entry.year && (
                  <span className="px-2 py-0.5 rounded-[var(--r-sm)] bg-[var(--layer-3)] text-[var(--text-2)]">{entry.year}</span>
                )}
                <span className="px-2 py-0.5 rounded-[var(--r-sm)] bg-[var(--layer-3)] text-[var(--text-2)]">
                  {readableChapters.length} readable chapter{readableChapters.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Tags */}
              {entry.tags && entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(tagsExpanded ? entry.tags : entry.tags.slice(0, tagLimit)).map((tag, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--layer-3)] text-[var(--text-2)]"
                    >
                      {tag}
                    </span>
                  ))}
                  {entry.tags.length > tagLimit && (
                    <button
                      type="button"
                      onClick={() => setTagsExpanded((v) => !v)}
                      className="px-2.5 py-0.5 rounded-full text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      {tagsExpanded ? 'Show fewer' : `+${entry.tags.length - tagLimit} more`}
                    </button>
                  )}
                </div>
              )}

              {/* Description */}
              {entry.summary && (
                <div className="mt-4">
                  <div
                    className={`text-sm text-[var(--text-2)] leading-relaxed [overflow-wrap:anywhere] ${
                      descExpanded ? '' : 'line-clamp-3 sm:line-clamp-5'
                    }`}
                  >
                    {safeHtml(entry.summary)}
                  </div>
                  {entry.summary.length > 320 && (
                    <button
                      type="button"
                      onClick={() => setDescExpanded((v) => !v)}
                      className="mt-1 text-xs font-semibold text-[var(--accent)] hover:underline cursor-pointer"
                    >
                      {descExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-[var(--stroke)]">
              {firstUnreadChapter && (
                <Button variant="accent" size={compact ? "md" : "lg"} onClick={handleStartReading}>
                  <BookOpen className="w-5 h-5 mr-2" />
                  {chapters.some((c) => progressByChapterId.get(c.id)?.read)
                    ? 'Continue Reading'
                    : 'Start Reading'}
                </Button>
              )}

              <Button
                variant={isFollowed ? 'standard' : 'subtle'}
                size={compact ? 'md' : 'lg'}
                title="Keeps this series in Library → Manga and checks it for new chapters (Updates)"
                onClick={handleToggleFollow}
              >
                {isFollowed ? (
                  <>
                    <BookmarkCheck className="w-5 h-5 mr-2 text-[var(--accent)]" />
                    In Library
                  </>
                ) : (
                  <>
                    <Bookmark className="w-5 h-5 mr-2" />
                    Add to Library
                  </>
                )}
              </Button>

              <IconButton
                label={isFavourite ? 'Remove from favourites' : 'Favourite: pinned to the top of your Manga library (also adds it)'}
                icon={<Heart className={`w-5 h-5 ${isFavourite ? 'fill-current text-[var(--danger)]' : ''}`} />}
                variant="subtle"
                onClick={() => void handleToggleFavourite()}
              />
            </div>

            {bookmarks.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">Bookmarks</h3>
                <div className="flex flex-wrap gap-2">
                  {bookmarks.map((b) => (
                    <span
                      key={`${b.chapterId}:${b.page}`}
                      className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-[var(--layer-2)] border border-[var(--stroke)] text-xs max-w-full"
                    >
                      <button
                        type="button"
                        onClick={() => openChapterAt(b.chapterId, b.page)}
                        className="truncate text-[var(--text-1)] hover:text-[var(--accent)] cursor-pointer"
                      >
                        {b.chapterTitle} · p. {b.page}
                      </button>
                      <button
                        type="button"
                        aria-label="Remove bookmark"
                        onClick={() =>
                          void toggleMangaBookmark(seriesId, sourceKind, {
                            chapterId: b.chapterId,
                            chapterTitle: b.chapterTitle,
                            page: b.page,
                          })
                        }
                        className="p-0.5 rounded-full text-[var(--text-3)] hover:text-[var(--danger)] cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chapters Section */}
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 flex-1 flex flex-col">
        {/* Controls: Search, Filter, Sort */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--stroke)]">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <div role="tablist" aria-label="Series view" className="flex items-center gap-1 p-0.5 rounded-[var(--r-md)] bg-[var(--layer-2)]">
              {(['chapters', 'pages'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--r-sm)] text-sm font-semibold cursor-pointer ${
                    view === v ? 'bg-[var(--layer-solid)] text-[var(--text-1)] shadow-xs' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
                  }`}
                >
                  {v === 'chapters' ? `Chapters (${chapters.length})` : (
                    <>
                      <Images className="w-4 h-4" /> Pages
                    </>
                  )}
                </button>
              ))}
            </div>
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

        {view === 'pages' ? (
          pageChapters.length === 0 ? (
            <p className="text-center text-xs text-[var(--text-3)] py-12">No readable chapters.</p>
          ) : (
            <div className="flex flex-col md:flex-row gap-6">
              {/* Phones: compact jump menu that follows the scroll position */}
              <select
                aria-label="Jump to chapter"
                value={currentPageChapter ?? ''}
                onChange={(e) => jumpToChapter(e.target.value)}
                className="md:hidden sticky top-[57px] z-20 h-9 px-2 rounded-[var(--r-md)] bg-[var(--layer-solid)] border border-[var(--stroke)] text-sm text-[var(--text-1)]"
              >
                {pageChapters.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[var(--layer-solid)]">
                    {c.title || `Chapter ${c.number ?? ''}`}
                  </option>
                ))}
              </select>

              {/* Lyrics-style chapter list: the chapter in view is bright and kept
                  centred; the rest are dimmed. Click to jump. */}
              <nav
                ref={chapterNavRef}
                aria-label="Chapters"
                className="hidden md:block w-60 shrink-0 self-start sticky top-[73px] max-h-[calc(100vh-170px)] overflow-y-auto no-scrollbar py-[30vh] [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]"
              >
                {pageChapters.map((c) => {
                  const active = c.id === currentPageChapter;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-nav-chapter={c.id}
                      onClick={() => jumpToChapter(c.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`block w-full text-left px-2 py-1.5 rounded-[var(--r-sm)] cursor-pointer transition-all duration-300 origin-left ${
                        active
                          ? 'text-[var(--text-1)] text-base font-bold scale-100'
                          : 'text-[var(--text-3)] text-sm font-semibold opacity-60 hover:opacity-100 hover:text-[var(--text-2)]'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {progressByChapterId.get(c.id)?.read && (
                          <Check className="w-3.5 h-3.5 text-[var(--success)] shrink-0" />
                        )}
                        <span className="truncate">{c.title || `Chapter ${c.number ?? ''}`}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>

              {/* Every chapter's pages, one after another; each loads as it nears view. */}
              <div className="flex-1 min-w-0 flex flex-col gap-10">
                {pageChapters.map((ch) => (
                  <ChapterPages
                    key={ch.id}
                    chapter={ch}
                    sourceKind={sourceKind}
                    read={!!progressByChapterId.get(ch.id)?.read}
                    onOpen={(page) => openChapterAt(ch.id, page)}
                  />
                ))}
              </div>
            </div>
          )
        ) : (
        /* Chapters List */
        <div className="space-y-2">
          {!loading && !error && readableChapters.length === 0 && (
            <div className="p-4 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-2)] leading-relaxed">
              {chapters.length === 0
                ? 'MangaDex has no English chapters of this series. It is usually because the series is officially licensed and the publisher asked for them to be removed.'
                : 'This series is only available as official releases on the publisher’s site, so it can’t be read inside Verso. The chapters below open the publisher’s own reader.'}
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
                  className={`group flex flex-wrap items-center justify-between p-3 rounded-[var(--r-md)] border transition-all ${
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
                        // Official releases can't be rendered as pages; open the
                        // publisher's reader in its own Verso window (browser on mobile).
                        void openInAppWindow(ch.externalUrl, ch.title || 'Chapter');
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
                        ? 'Official release · opens the publisher’s reader'
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
        )}
      </div>
    </div>
  );
}

// Pages of one chapter, fetched only when the section scrolls near the viewport.
const pagesCache = new Map<string, PageRef[]>();

function ChapterPages({
  chapter,
  sourceKind,
  read,
  onOpen,
}: {
  chapter: ChapterInfo;
  sourceKind: string;
  read: boolean;
  onOpen: (page: number) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [pages, setPages] = useState<PageRef[] | null>(() => pagesCache.get(chapter.id) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pages || !ref.current) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void (async () => {
          try {
            const source = (await getSourceById(sourceKind)) as MangaSource;
            const list = await source.pages(chapter.id, true);
            pagesCache.set(chapter.id, list);
            if (!cancelled) setPages(list);
          } catch (err) {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(ref.current);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [pages, chapter.id, sourceKind]);

  return (
    <section ref={ref} data-chapter-id={chapter.id} className="min-h-[200px] scroll-mt-[72px]">
      <h3 className="py-2 mb-3 border-b border-[var(--stroke)] text-base font-semibold text-[var(--text-1)] flex items-center gap-2">
        {read && <Check className="w-4 h-4 text-[var(--success)] shrink-0" />}
        <span className="truncate">{chapter.title || `Chapter ${chapter.number ?? ''}`}</span>
        {pages && <span className="text-xs font-normal text-[var(--text-3)] shrink-0">{pages.length} pages</span>}
      </h3>
      {error ? (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      ) : !pages ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-[2/3] rounded-[var(--r-md)] bg-[var(--layer-2)] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {pages.map((pg) => (
            <button
              key={pg.index}
              type="button"
              onClick={() => onOpen(pg.index)}
              title={`Read from page ${pg.index}`}
              className="relative aspect-[2/3] rounded-[var(--r-md)] overflow-hidden bg-[var(--layer-3)] border border-[var(--stroke)] hover:border-[var(--accent)] hover:-translate-y-0.5 transition-transform cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] outline-none"
            >
              <img
                src={pg.url}
                alt={`Page ${pg.index}`}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.dataset.retried) return;
                  target.dataset.retried = '1';
                  void net.loadProtectedImage(pg.url).then((blobUrl) => {
                    target.src = blobUrl;
                  }).catch(() => {});
                }}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 right-1 text-[11px] font-semibold text-white bg-black/65 rounded px-1.5 py-0.5">
                {pg.index}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
