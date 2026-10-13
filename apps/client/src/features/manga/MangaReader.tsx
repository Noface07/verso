import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RotateCw,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { db, dirty, now, uid, type ChapterProgress, type ReadingSession } from '../../db';
import { getSourceById } from '../../sources/registry';
import type { MangaSource, ChapterInfo, PageRef } from '../../sources/types';
import { Button } from '../../design/components/Button';
import { IconButton } from '../../design/components/IconButton';
import { ProgressRing } from '../../design/components/Progress';

export type ReadingMode = 'paged-rtl' | 'paged-ltr' | 'webtoon';
export type FitMode = 'width' | 'height' | 'screen' | 'original';

export default function MangaReader() {
  const { seriesId: rawSeriesId, chapterId: rawChapterId } = useParams<{
    seriesId: string;
    chapterId: string;
  }>();
  const navigate = useNavigate();

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
  const [readingMode, setReadingMode] = useState<ReadingMode>('paged-rtl');
  const [fitMode, setFitMode] = useState<FitMode>('width');
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTransitionScreen, setIsTransitionScreen] = useState(false);

  // Session timer
  const sessionStartRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide HUD on idle
  const resetHudTimer = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    setHudVisible(true);
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
    }, 4000);
  }, []);

  // Load Chapter and Pages
  const loadChapterData = useCallback(async () => {
    if (!seriesId || !chapterId) return;
    setLoading(true);
    setError(null);
    setIsTransitionScreen(false);

    try {
      const source = (await getSourceById(sourceKind)) as MangaSource;
      if (!source) throw new Error(`Unsupported source: ${sourceKind}`);

      const chList = await source.chapters(seriesId);
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
        setPages(remotePages);
      }
      setPageObjectUrls(objectUrlMap);

      // Restore saved progress
      const savedProgress = await db.chapter_progress
        .filter((p) => p.series_id === seriesId && p.chapter_id === chapterId && !p.deleted_at)
        .first();

      if (savedProgress && savedProgress.page && savedProgress.page > 0) {
        setCurrentPage(savedProgress.page);
      } else {
        setCurrentPage(1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      resetHudTimer();
    }
  }, [seriesId, chapterId, sourceKind, resetHudTimer]);

  useEffect(() => {
    void loadChapterData();
    sessionStartRef.current = Date.now();

    return () => {
      // Record reading session on unmount
      const durationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);
      if (durationSec >= 10 && seriesId) {
        const session: ReadingSession = {
          id: uid(),
          book_id: seriesId,
          started_at: sessionStartRef.current,
          ended_at: Date.now(),
          duration_sec: durationSec,
          start_percent: 0,
          end_percent: 100,
          words_read: 0,
          device_id: 'local',
          kind: 'manga',
          deleted_at: null,
          ...dirty(),
        };
        void db.reading_sessions.put(session);
      }

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

      // Update series last_read_at
      const seriesRecord = await db.series.get(seriesId);
      if (seriesRecord) {
        await db.series.update(seriesId, {
          last_read_at: now(),
          ...dirty(),
        });
      }
    },
    [seriesId, chapterId, sourceKind, currentChapter, pages.length],
  );

  // Navigation logic
  const currentChapterIndex = useMemo(() => {
    return chapters.findIndex((c) => c.id === chapterId);
  }, [chapters, chapterId]);

  const prevChapter = useMemo(() => {
    if (currentChapterIndex > 0) return chapters[currentChapterIndex - 1];
    return null;
  }, [chapters, currentChapterIndex]);

  const nextChapter = useMemo(() => {
    if (currentChapterIndex !== -1 && currentChapterIndex < chapters.length - 1) {
      return chapters[currentChapterIndex + 1];
    }
    return null;
  }, [chapters, currentChapterIndex]);

  const goToNextPage = useCallback(() => {
    if (currentPage < pages.length) {
      const next = currentPage + 1;
      setCurrentPage(next);
      void saveProgress(next, next === pages.length);
    } else {
      setIsTransitionScreen(true);
      void saveProgress(pages.length, true);
    }
  }, [currentPage, pages.length, saveProgress]);

  const goToPrevPage = useCallback(() => {
    if (isTransitionScreen) {
      setIsTransitionScreen(false);
      return;
    }
    if (currentPage > 1) {
      const prev = currentPage - 1;
      setCurrentPage(prev);
      void saveProgress(prev, false);
    }
  }, [isTransitionScreen, currentPage, saveProgress]);

  const goToChapter = (targetChapterId: string) => {
    navigate(
      `/read/manga/${encodeURIComponent(seriesId)}/${encodeURIComponent(targetChapterId)}`,
    );
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetHudTimer();
      if (e.key === 'Escape') {
        if (isFullscreen) {
          void document.exitFullscreen();
        } else {
          navigate(`/series/${encodeURIComponent(seriesId)}`);
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
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      void document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-white">
        <ProgressRing size={40} />
        <p className="text-xs text-white/70 mt-3">Loading chapter pages…</p>
      </div>
    );
  }

  if (error || pages.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-6 text-center text-white">
        <AlertCircle className="w-12 h-12 text-[var(--danger)] mb-3" />
        <h2 className="text-lg font-bold">Failed to load chapter</h2>
        <p className="text-xs text-white/70 mt-1 max-w-sm">{error || 'No pages found'}</p>
        <div className="flex gap-3 mt-4">
          <Button variant="subtle" onClick={() => navigate(`/series/${encodeURIComponent(seriesId)}`)}>
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
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden"
    >
      {/* Top HUD Header */}
      <header
        className={`absolute top-0 inset-x-0 z-40 bg-black/80 backdrop-blur-md px-4 py-2.5 flex items-center justify-between text-white transition-all duration-200 border-b border-white/10 ${
          hudVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <IconButton
            icon={<ArrowLeft className="w-5 h-5 text-white" />}
            label="Back to series"
            variant="subtle"
            onClick={() => navigate(`/series/${encodeURIComponent(seriesId)}`)}
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
        <div className="flex items-center gap-2">
          {/* Reading Mode Selector */}
          <select
            value={readingMode}
            onChange={(e) => setReadingMode(e.target.value as ReadingMode)}
            className="bg-white/10 text-white text-xs px-2 py-1 rounded-[var(--r-sm)] border border-white/20 outline-none cursor-pointer"
          >
            <option value="paged-rtl" className="bg-neutral-900 text-white">RTL (Manga)</option>
            <option value="paged-ltr" className="bg-neutral-900 text-white">LTR (Comic)</option>
            <option value="webtoon" className="bg-neutral-900 text-white">Webtoon (Strip)</option>
          </select>

          {/* Fit Mode Selector */}
          <select
            value={fitMode}
            onChange={(e) => setFitMode(e.target.value as FitMode)}
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

            <div className="flex gap-3">
              <Button
                variant="subtle"
                onClick={() => navigate(`/series/${encodeURIComponent(seriesId)}`)}
              >
                Back to Series
              </Button>
              {nextChapter ? (
                <Button variant="accent" onClick={() => goToChapter(nextChapter.id)}>
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
          <div className="relative w-full h-full flex items-center justify-center p-2">
            <img
              src={activeImageUrl}
              alt={`Page ${currentPage}`}
              className={`select-none transition-all duration-75 ${
                fitMode === 'width'
                  ? 'w-full max-w-5xl object-contain'
                  : fitMode === 'height'
                    ? 'h-full object-contain'
                    : fitMode === 'screen'
                      ? 'max-w-full max-h-full object-contain'
                      : 'object-none'
              }`}
            />

            {/* Credit notice on first page */}
            {currentPage === 1 && (
              <div className="absolute top-14 left-4 px-2.5 py-1 rounded bg-black/70 border border-white/10 text-[11px] text-white/80 pointer-events-none backdrop-blur-sm">
                Scanlation: {currentChapter?.scanlationGroup || 'Unknown'} · Hosted on MangaDex
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom HUD Scrubber Bar */}
      <footer
        className={`absolute bottom-0 inset-x-0 z-40 bg-black/80 backdrop-blur-md px-6 py-3 flex flex-col gap-2 text-white transition-all duration-200 border-t border-white/10 ${
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
            Page {currentPage} of {pages.length}
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
