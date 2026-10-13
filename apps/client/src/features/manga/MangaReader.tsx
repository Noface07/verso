import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RotateCw,
  CheckCircle,
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Columns2,
} from 'lucide-react';
import { db, dirty, now, uid, type ChapterProgress } from '../../db';
import { getSourceById } from '../../sources/registry';
import type { MangaSource, ChapterInfo, PageRef } from '../../sources/types';
import { Button } from '../../design/components/Button';
import { IconButton } from '../../design/components/IconButton';
import { ProgressRing } from '../../design/components/Progress';
import { useReadingSession } from '../../lib/session';
import { recordSeriesRead } from '../../lib/series';
import { setKeepScreenOn, triggerHaptic, useVolumeKeys } from '../../lib/mobileUx';
import { registerBackHandler } from '../../lib/backStack';
import { toggleAppFullscreen, useAppFullscreen, exitAppFullscreen } from '../../lib/useAppFullscreen';
import { isMangaPageBookmarked, toggleMangaBookmark } from '../../lib/series';
import { useLiveQuery } from 'dexie-react-hooks';

export type ReadingMode = 'paged-rtl' | 'paged-ltr' | 'webtoon';
export type FitMode = 'width' | 'height' | 'screen' | 'original';

interface MangaPrefs {
  readingMode: ReadingMode;
  fitMode: FitMode;
  /** Show two pages side by side in paged modes. */
  spread: boolean;
  /** In spread mode, show the first page (usually the cover) on its own. */
  coverAlone: boolean;
  /** Go straight to the next chapter at the end instead of stopping. */
  autoNext: boolean;
}
const PREFS_KEY = 'folio_manga_reader';
const DEFAULT_PREFS: MangaPrefs = {
  readingMode: 'paged-rtl',
  fitMode: 'screen',
  spread: false,
  coverAlone: true,
  autoNext: true,
};
function loadPrefs(): MangaPrefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<MangaPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** First page of the spread containing `page` (1-based). */
function spreadStart(page: number, coverAlone: boolean): number {
  if (coverAlone) return page <= 1 ? 1 : page - ((page - 2) % 2);
  return page - ((page - 1) % 2);
}

export default function MangaReader() {
  const { seriesId: rawSeriesId, chapterId: rawChapterId } = useParams<{
    seriesId: string;
    chapterId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?page=N (from a bookmark) overrides the saved position for this open.
  const requestedPage = Number(searchParams.get('page')) || 0;

  const seriesId = decodeURIComponent(rawSeriesId || '');
  const chapterId = decodeURIComponent(rawChapterId || '');
  const sourceKind = seriesId.split(':')[0] || 'mangadex';

  // Chapter & Page data
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [currentChapter, setCurrentChapter] = useState<ChapterInfo | null>(null);
  const [pages, setPages] = useState<PageRef[]>([]);
  const [pageObjectUrls, setPageObjectUrls] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reader state
  const [currentPage, setCurrentPage] = useState(1);
  const [prefs, setPrefs] = useState<MangaPrefs>(loadPrefs);
  const updatePrefs = (patch: Partial<MangaPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: applies for this session only.
      }
      return next;
    });
  const { readingMode, fitMode } = prefs;
  const spread = prefs.spread && readingMode !== 'webtoon';
  const [hudVisible, setHudVisible] = useState(true);
  const isFullscreen = useAppFullscreen();
  const [isTransitionScreen, setIsTransitionScreen] = useState(false);
  const [chapterToast, setChapterToast] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session tracking with idle detection
  const fractionRef = useRef<number>(0);
  const pagesReadRef = useRef<number>(0);

  useEffect(() => {
    if (pages.length > 0) {
      fractionRef.current = currentPage / pages.length;
      pagesReadRef.current = Math.max(pagesReadRef.current, currentPage);
    }
  }, [currentPage, pages.length]);

  const { recordActivity } = useReadingSession(
    seriesId,
    !loading && pages.length > 0 && !!seriesId,
    fractionRef,
    undefined,
    { kind: 'manga', pagesReadRef },
  );

  // Auto-hide HUD on idle
  const resetHudTimer = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    setHudVisible(true);
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
    }, 4000);
  }, []);

  // Load Chapter and Pages
  // Only the latest chapter load may write state: flipping chapters quickly used to
  // let the previous chapter's pages land on top of the new one.
  const loadSeq = useRef(0);
  const loadChapterData = useCallback(async () => {
    if (!seriesId || !chapterId) return;
    const ticket = ++loadSeq.current;
    const isCurrent = () => ticket === loadSeq.current;
    setLoading(true);
    setError(null);
    setIsTransitionScreen(false);

    try {
      const source = (await getSourceById(sourceKind)) as MangaSource;
      if (!source) throw new Error(`Unsupported source: ${sourceKind}`);

      const chList = await source.chapters(seriesId);
      if (!isCurrent()) return;
      setChapters(chList);

      const ch = chList.find((c) => c.id === chapterId) || {
        id: chapterId,
        title: 'Chapter',
      };
      setCurrentChapter(ch);

      // Check if pages are cached in db.manga_pages offline table
      const cachedPages = await db.manga_pages
        .where('[series_id+chapter_id]')
        .equals([seriesId, chapterId])
        .toArray();
      if (!isCurrent()) return;

      const objectUrlMap = new Map<number, string>();
      if (cachedPages.length > 0) {
        cachedPages.sort((a, b) => a.page - b.page);
        const pageRefs: PageRef[] = [];
        for (const cp of cachedPages) {
          const url = URL.createObjectURL(cp.blob);
          objectUrlMap.set(cp.page, url);
          pageRefs.push({ index: cp.page, url });
        }
        setPages(pageRefs);
      } else {
        const remotePages = await source.pages(chapterId);
        if (!isCurrent()) return;
        setPages(remotePages);
      }
      setPageObjectUrls(objectUrlMap);

      // Restore saved progress
      const savedProgress = await db.chapter_progress
        .filter((p) => p.series_id === seriesId && p.chapter_id === chapterId && !p.deleted_at)
        .first();
      if (!isCurrent()) return;

      if (requestedPage > 0) {
        setCurrentPage(requestedPage);
      } else if (savedProgress && savedProgress.page && savedProgress.page > 0 && !savedProgress.read) {
        setCurrentPage(savedProgress.page);
      } else {
        // New or already-finished chapter: start from the beginning.
        setCurrentPage(1);
      }
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) {
        setLoading(false);
        resetHudTimer();
      }
    }
  }, [seriesId, chapterId, sourceKind, resetHudTimer, requestedPage]);

  useEffect(() => {
    void loadChapterData();

    return () => {
      // Revoke created blob URLs
      pageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [loadChapterData]);

  // Preload upcoming images
  useEffect(() => {
    if (pages.length === 0) return;
    const preloadAhead = 4;
    for (let i = currentPage; i <= Math.min(pages.length, currentPage + preloadAhead); i++) {
      const p = pages[i - 1];
      if (p) {
        const img = new Image();
        img.src = pageObjectUrls.get(p.index) || p.url;
      }
    }
  }, [currentPage, pages, pageObjectUrls]);

  // Save chapter progress (debounced)
  const saveProgress = useCallback(
    async (pageIndex: number, isFinished: boolean) => {
      if (!seriesId || !chapterId) return;

      const existing = await db.chapter_progress
        .filter((p) => p.series_id === seriesId && p.chapter_id === chapterId && !p.deleted_at)
        .first();

      if (existing) {
        await db.chapter_progress.update(existing.id, {
          page: pageIndex,
          total_pages: pages.length,
          read: isFinished || existing.read,
          read_at: isFinished ? now() : existing.read_at,
          ...dirty(),
        });
      } else {
        const newProg: ChapterProgress = {
          id: uid(),
          series_id: seriesId,
          source: sourceKind,
          chapter_id: chapterId,
          chapter_number: currentChapter?.number,
          title: currentChapter?.title,
          page: pageIndex,
          total_pages: pages.length,
          read: isFinished,
          read_at: isFinished ? now() : undefined,
          deleted_at: null,
          ...dirty(),
        };
        await db.chapter_progress.put(newProg);
      }

      // Reading history: previously only followed series got last_read_at, so
      // anything read without following left no trace.
      await recordSeriesRead(seriesId, sourceKind, async () => {
        const source = (await getSourceById(sourceKind)) as MangaSource | undefined;
        return source?.details ? source.details(seriesId) : null;
      });
    },
    [seriesId, chapterId, sourceKind, currentChapter, pages.length],
  );

  // Navigation logic
  const currentChapterIndex = useMemo(() => {
    return chapters.findIndex((c) => c.id === chapterId);
  }, [chapters, chapterId]);

  // Skip official external-only chapters: their pages aren't hosted, so they can't
  // be shown here and used to dead-end the reader.
  const prevChapter = useMemo(() => {
    if (currentChapterIndex <= 0) return null;
    return chapters.slice(0, currentChapterIndex).reverse().find((c) => !c.externalUrl) ?? null;
  }, [chapters, currentChapterIndex]);

  const nextChapter = useMemo(() => {
    if (currentChapterIndex === -1) return null;
    return chapters.slice(currentChapterIndex + 1).find((c) => !c.externalUrl) ?? null;
  }, [chapters, currentChapterIndex]);

  // Chapter-to-chapter moves replace the history entry: pushing each chapter (and
  // pushing the series page on "Back") made Back bounce between reader and series.
  const goToChapter = useCallback(
    (targetChapterId: string) => {
      navigate(
        `/read/manga/${encodeURIComponent(seriesId)}/${encodeURIComponent(targetChapterId)}`,
        { replace: true },
      );
    },
    [navigate, seriesId],
  );

  // Pages currently on screen: one, or two in spread mode.
  const visiblePages = useMemo(() => {
    if (!spread) return [currentPage];
    const start = spreadStart(currentPage, prefs.coverAlone);
    if (prefs.coverAlone && start === 1) return [1];
    return start + 1 <= pages.length ? [start, start + 1] : [start];
  }, [spread, currentPage, prefs.coverAlone, pages.length]);
  const lastVisible = visiblePages[visiblePages.length - 1];

  const goToNextPage = useCallback(() => {
    recordActivity();
    if (lastVisible < pages.length) {
      const next = lastVisible + 1;
      setCurrentPage(next);
      const nextLast = spread ? Math.min(pages.length, next + (prefs.coverAlone && next === 1 ? 0 : 1)) : next;
      void saveProgress(next, nextLast >= pages.length);
      return;
    }
    void saveProgress(pages.length, true);
    // Keep reading: jump straight into the next chapter instead of stopping on a
    // "Finished chapter" screen every time (the end screen remains when caught up).
    if (prefs.autoNext && nextChapter) {
      setChapterToast(nextChapter.title || `Chapter ${nextChapter.number ?? ''}`);
      goToChapter(nextChapter.id);
    } else {
      setIsTransitionScreen(true);
    }
  }, [lastVisible, pages.length, spread, prefs.coverAlone, prefs.autoNext, nextChapter, goToChapter, saveProgress, recordActivity]);

  const goToPrevPage = useCallback(() => {
    recordActivity();
    if (isTransitionScreen) {
      setIsTransitionScreen(false);
      return;
    }
    const first = visiblePages[0];
    if (first > 1) {
      const prev = spread ? spreadStart(first - 1, prefs.coverAlone) : first - 1;
      setCurrentPage(prev);
      void saveProgress(prev, false);
    }
  }, [isTransitionScreen, visiblePages, spread, prefs.coverAlone, saveProgress, recordActivity]);

  useEffect(() => {
    if (!chapterToast) return;
    const t = setTimeout(() => setChapterToast(null), 1800);
    return () => clearTimeout(t);
  }, [chapterToast]);

  // Keep screen on while reading manga (P11.1 & P11.3)
  useEffect(() => {
    void setKeepScreenOn(true);
    return () => {
      void setKeepScreenOn(false);
    };
  }, []);

  // Volume keys for page turn (P11.5)
  useVolumeKeys(
    () => {
      goToNextPage();
      triggerHaptic('light');
    },
    () => {
      goToPrevPage();
      triggerHaptic('light');
    },
    !loading,
  );

  // Android back button closes transition screen or hud before navigating
  useEffect(() => {
    return registerBackHandler(() => {
      if (isTransitionScreen) {
        setIsTransitionScreen(false);
        return true;
      }
      if (hudVisible) {
        setHudVisible(false);
        return true;
      }
      return false;
    }, 40);
  }, [isTransitionScreen, hudVisible]);


  const exitReader = () => {
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
    else navigate(`/series/${encodeURIComponent(seriesId)}`, { replace: true });
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetHudTimer();
      if (e.key === 'Escape') {
        if (isFullscreen) {
          void exitAppFullscreen();
        } else {
          exitReader();
        }
      } else if (e.key === 'ArrowRight') {
        if (readingMode === 'paged-rtl') goToPrevPage();
        else goToNextPage();
      } else if (e.key === 'ArrowLeft') {
        if (readingMode === 'paged-rtl') goToNextPage();
        else goToPrevPage();
      } else if (e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        goToPrevPage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readingMode, goToNextPage, goToPrevPage, isFullscreen, navigate, seriesId, resetHudTimer]);

  // Wheel handling (§5.2: In RTL paged, wheel down still advances next page)
  const handleWheel = (e: React.WheelEvent) => {
    if (readingMode === 'webtoon') return; // native scroll in webtoon mode
    if (Math.abs(e.deltaY) > 20) {
      if (e.deltaY > 0) goToNextPage();
      else goToPrevPage();
    }
  };

  // Tap zones: Left third / Center / Right third
  const handleScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    if (x < width * 0.33) {
      if (readingMode === 'paged-rtl') goToNextPage();
      else goToPrevPage();
    } else if (x > width * 0.67) {
      if (readingMode === 'paged-rtl') goToPrevPage();
      else goToNextPage();
    } else {
      setHudVisible((v) => !v);
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    void toggleAppFullscreen();
  };

  // Bookmarks live on the series row (synced), keyed by chapter + page.
  const seriesRow = useLiveQuery(() => db.series.get(seriesId), [seriesId]);
  const pageBookmarked = isMangaPageBookmarked(seriesRow, chapterId, currentPage);
  const toggleBookmark = () =>
    void toggleMangaBookmark(seriesId, sourceKind, {
      chapterId,
      chapterTitle: currentChapter?.title || 'Chapter',
      page: currentPage,
    });

  if (loading) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-50 bg-black flex flex-col items-center justify-center text-white">
        <ProgressRing size={40} />
        <p className="text-xs text-white/70 mt-3">Loading chapter pages…</p>
      </div>
    );
  }

  if (error || pages.length === 0) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-50 bg-black flex flex-col items-center justify-center p-6 text-center text-white">
        <AlertCircle className="w-12 h-12 text-[var(--danger)] mb-3" />
        <h2 className="text-lg font-bold">Failed to load chapter</h2>
        <p className="text-xs text-white/70 mt-1 max-w-sm">{error || 'No pages found'}</p>
        <div className="flex gap-3 mt-4">
          <Button variant="subtle" onClick={exitReader}>
            Back to Series
          </Button>
          <Button variant="standard" onClick={loadChapterData}>
            <RotateCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const activePageRef = pages[currentPage - 1];
  const activeImageUrl = activePageRef
    ? pageObjectUrls.get(activePageRef.index) || activePageRef.url
    : '';

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHudTimer}
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] z-50 bg-black flex flex-col select-none overflow-hidden"
    >
      {/* Top HUD Header */}
      <header
        className={`absolute top-0 inset-x-0 z-40 bg-black/90 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 text-white transition-all duration-200 border-b border-white/10 ${
          hudVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <IconButton
            icon={<ArrowLeft className="w-5 h-5 text-white" />}
            label="Back to series"
            variant="subtle"
            onClick={exitReader}
          />
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-white truncate max-w-xs md:max-w-md">
              {currentChapter?.title || 'Chapter'}
            </h3>
            <p className="text-[10px] text-white/60 truncate">
              Scanlation: {currentChapter?.scanlationGroup || 'Unknown'} · MangaDex
            </p>
          </div>
        </div>

        {/* Reader settings in header */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <IconButton
            icon={
              pageBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-[var(--accent)]" />
              ) : (
                <Bookmark className="w-4 h-4 text-white" />
              )
            }
            label={pageBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            variant="subtle"
            onClick={toggleBookmark}
          />
          {readingMode !== 'webtoon' && (
            <IconButton
              icon={<Columns2 className={`w-4 h-4 ${prefs.spread ? 'text-[var(--accent)]' : 'text-white'}`} />}
              label={prefs.spread ? 'Single page' : 'Two pages side by side'}
              variant="subtle"
              onClick={() => updatePrefs({ spread: !prefs.spread })}
            />
          )}
          <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-white/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={prefs.autoNext}
              onChange={(e) => updatePrefs({ autoNext: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            Auto next chapter
          </label>
          {/* Reading Mode Selector */}
          <select
            aria-label="Reading mode"
            value={readingMode}
            onChange={(e) => updatePrefs({ readingMode: e.target.value as ReadingMode })}
            className="bg-white/10 text-white text-xs px-2 py-1 rounded-[var(--r-sm)] border border-white/20 outline-none cursor-pointer"
          >
            <option value="paged-rtl" className="bg-neutral-900 text-white">RTL (Manga)</option>
            <option value="paged-ltr" className="bg-neutral-900 text-white">LTR (Comic)</option>
            <option value="webtoon" className="bg-neutral-900 text-white">Webtoon (Strip)</option>
          </select>

          {/* Fit Mode Selector */}
          <select
            aria-label="Fit"
            value={fitMode}
            onChange={(e) => updatePrefs({ fitMode: e.target.value as FitMode })}
            className="bg-white/10 text-white text-xs px-2 py-1 rounded-[var(--r-sm)] border border-white/20 outline-none cursor-pointer"
          >
            <option value="width" className="bg-neutral-900 text-white">Fit Width</option>
            <option value="height" className="bg-neutral-900 text-white">Fit Height</option>
            <option value="screen" className="bg-neutral-900 text-white">Fit Screen</option>
            <option value="original" className="bg-neutral-900 text-white">Original</option>
          </select>

          <IconButton
            icon={isFullscreen ? <Minimize2 className="w-4 h-4 text-white" /> : <Maximize2 className="w-4 h-4 text-white" />}
            label="Toggle fullscreen"
            variant="subtle"
            onClick={toggleFullscreen}
          />
        </div>
      </header>

      {/* Main Reader View */}
      <div
        className="flex-1 w-full h-full flex items-center justify-center overflow-auto"
        onWheel={handleWheel}
        onClick={handleScreenClick}
      >
        {isTransitionScreen ? (
          /* Chapter Transition Screen */
          <div className="flex flex-col items-center justify-center p-6 text-center text-white max-w-md animate-in fade-in-0 duration-200">
            <CheckCircle className="w-16 h-16 text-[var(--success)] mb-4" />
            <h2 className="text-xl font-bold">Finished Chapter</h2>
            <p className="text-sm text-white/70 mt-1">
              {currentChapter?.title || 'Chapter completed'}
            </p>

            <div className="p-3 my-6 rounded-[var(--r-md)] bg-white/10 border border-white/20 text-xs text-white/80 w-full">
              Scanlation: {currentChapter?.scanlationGroup || 'No Group'}
              <br />
              Hosted on MangaDex
            </div>

            <div className="flex flex-wrap justify-center gap-3 max-w-full">
              <Button
                variant="subtle"
                onClick={exitReader}
              >
                Back to Series
              </Button>
              {nextChapter ? (
                <Button variant="accent" className="max-w-full" onClick={() => goToChapter(nextChapter.id)}>
                  Next: {nextChapter.title || `Chapter ${nextChapter.number}`}
                </Button>
              ) : (
                <p className="text-xs text-[var(--accent)] font-semibold mt-2">
                  You are all caught up!
                </p>
              )}
            </div>
          </div>
        ) : readingMode === 'webtoon' ? (
          /* Webtoon Continuous Vertical Strip */
          <div className="w-full flex flex-col items-center overflow-y-auto no-scrollbar py-8">
            {pages.map((p) => {
              const url = pageObjectUrls.get(p.index) || p.url;
              return (
                <div key={p.index} className="relative w-full max-w-3xl flex justify-center">
                  <img
                    src={url}
                    alt={`Page ${p.index}`}
                    loading="lazy"
                    className="w-full object-contain select-none"
                  />
                  {p.index === 1 && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-[10px] text-white/80 pointer-events-none">
                      Scanlation: {currentChapter?.scanlationGroup || 'Unknown'} · MangaDex
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Paged Mode (LTR or RTL) */
          <div
            className={`relative w-full h-full flex items-center justify-center p-2 gap-1 ${
              readingMode === 'paged-rtl' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {visiblePages.map((n) => {
              const ref = pages.find((p) => p.index === n);
              const url = ref ? pageObjectUrls.get(ref.index) || ref.url : activeImageUrl;
              const two = visiblePages.length === 2;
              return (
                <img
                  key={n}
                  src={url}
                  alt={`Page ${n}`}
                  draggable={false}
                  className={`select-none ${
                    two
                      ? 'max-w-[50%] max-h-full object-contain'
                      : fitMode === 'width'
                        ? 'w-full max-w-5xl object-contain'
                        : fitMode === 'height'
                          ? 'h-full object-contain'
                          : fitMode === 'screen'
                            ? 'max-w-full max-h-full object-contain'
                            : 'object-none'
                  }`}
                />
              );
            })}

            {/* Credit notice on first page */}
            {currentPage === 1 && (
              <div className="absolute top-14 left-4 px-2.5 py-1 rounded bg-black/70 border border-white/10 text-[11px] text-white/80 pointer-events-none backdrop-blur-sm">
                Scanlation: {currentChapter?.scanlationGroup || 'Unknown'} · Hosted on MangaDex
              </div>
            )}
          </div>
        )}
      </div>

      {chapterToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/85 border border-white/15 text-white text-xs font-medium pointer-events-none animate-in fade-in-0 duration-200 max-w-[90%] truncate">
          Now reading: {chapterToast}
        </div>
      )}

      {/* Bottom HUD Scrubber Bar */}
      <footer
        className={`absolute bottom-0 inset-x-0 z-40 bg-black/90 px-3 sm:px-6 py-3 flex flex-col gap-2 text-white transition-all duration-200 border-t border-white/10 ${
          hudVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between text-xs font-medium text-white/80">
          <button
            type="button"
            disabled={!prevChapter}
            onClick={() => prevChapter && goToChapter(prevChapter.id)}
            className="flex items-center gap-1 hover:text-white disabled:opacity-30 disabled:hover:text-white/80 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" /> Prev Chapter
          </button>

          <span>
            Page {visiblePages.length === 2 ? `${visiblePages[0]}–${visiblePages[1]}` : currentPage} of {pages.length}
          </span>

          <button
            type="button"
            disabled={!nextChapter}
            onClick={() => nextChapter && goToChapter(nextChapter.id)}
            className="flex items-center gap-1 hover:text-white disabled:opacity-30 disabled:hover:text-white/80 cursor-pointer"
          >
            Next Chapter <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Page Scrubber Slider */}
        {readingMode !== 'webtoon' && (
          <input
            type="range"
            min={1}
            max={pages.length}
            value={currentPage}
            onChange={(e) => {
              const p = parseInt(e.target.value, 10);
              setCurrentPage(p);
              void saveProgress(p, p === pages.length);
            }}
            className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
          />
        )}
      </footer>
    </div>
  );
}
