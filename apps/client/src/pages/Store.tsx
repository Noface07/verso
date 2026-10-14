import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Download,
  BookOpen,
  Check,
  RotateCw,
  Plus,
  Trash2,
  X,
  Layers,
  ShoppingBag,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { db, type Book, type DownloadItem } from '../db';
import {
  getAllBookSources,
  addCustomOpdsSource,
  addCustomSuwayomiSource,
  addCustomKomgaSource,
  removeCustomSource,
} from '../sources/registry';
import { SuwayomiSource, type SuwayomiExtension } from '../sources/suwayomi';
import {
  isAdultRating,
  type CatalogEntry,
  type CatalogSection,
  type CatalogSource,
} from '../sources/types';
import { downloadManager } from '../features/downloads/manager';
import { safeHtml } from '../lib/safeHtml';
import { CoverGrid } from '../design/components/CoverGrid';
import { BookCard } from '../design/components/BookCard';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { Dialog } from '../design/components/Dialog';
import { Popover } from '../design/components/Popover';
import { SearchBox } from '../design/components/SearchBox';
import { ProgressBar, ProgressRing } from '../design/components/Progress';
import { EmptyState } from '../design/components/EmptyState';
import { PullToRefresh } from '../components/PullToRefresh';

// Snapshot of the Store kept while the app runs. Opening a title and pressing Back
// unmounts the Store; without this, the source, section, search, filters, loaded
// pages and scroll position were all lost and had to be found again.
interface StoreSnapshot {
  sourceId: string;
  sectionId: string;
  query: string;
  filters: Record<string, string>;
  sections: CatalogSection[];
  items: CatalogEntry[];
  nextCursor?: string;
  scrollTop: number;
}
let storeSnapshot: StoreSnapshot | null = null;

// Free, legal catalog and server presets
const SOURCE_PRESETS = [
  {
    name: 'unglue.it (free ebooks)',
    kind: 'opds' as const,
    url: 'https://unglue.it/api/opds/epub/?order_by=popular',
    about: 'Books released for free by their rights holders (Creative Commons and similar). EPUB only.',
  },
  {
    name: 'Suwayomi Server (Localhost)',
    kind: 'suwayomi' as const,
    url: 'http://localhost:4567',
    about: 'Local Suwayomi (Tachidesk) server. Unlocks all installed Tachiyomi & Mihon extensions.',
  },
  {
    name: 'Komga Server (Localhost)',
    kind: 'komga' as const,
    url: 'http://localhost:25600',
    about: 'Local Komga comics/manga server with OPDS & REST page streaming.',
  },
];

// Built-in sources can't be removed; only custom sources get a delete button.
const BUILT_IN_SOURCE_IDS = new Set([
  'gutenberg',
  'standardebooks',
  'openlibrary',
  'archiveorg',
  'mangadex',
  'mangapill',
  'suwayomi',
]);

export default function Store() {
  const snap = storeSnapshot;
  const rootRef = useRef<HTMLDivElement>(null);
  // Fetch key the snapshot already satisfies; the first matching fetch is skipped.
  const restoredKeyRef = useRef<string | null>(
    snap ? JSON.stringify([snap.sourceId, snap.sectionId, snap.query, snap.filters]) : null,
  );
  const navigate = useNavigate();

  // Sources
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>(snap?.sourceId ?? 'gutenberg');
  const [sections, setSections] = useState<CatalogSection[]>(snap?.sections ?? []);
  const [activeSectionId, setActiveSectionId] = useState<string>(snap?.sectionId ?? 'popular');

  // Search & Catalog items
  const [searchQuery, setSearchQuery] = useState(snap?.query ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(snap?.query ?? '');
  const [items, setItems] = useState<CatalogEntry[]>(snap?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | undefined>(snap?.nextCursor);
  const [loading, setLoading] = useState(!snap);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [selectedBook, setSelectedBook] = useState<CatalogEntry | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [newSourceKind, setNewSourceKind] = useState<'opds' | 'suwayomi' | 'komga'>('opds');
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceUser, setNewSourceUser] = useState('');
  const [newSourcePass, setNewSourcePass] = useState('');
  const [newSourceApiKey, setNewSourceApiKey] = useState('');
  const [addSourceLoading, setAddSourceLoading] = useState(false);
  const [addSourceError, setAddSourceError] = useState<string | null>(null);

  // Live queries
  const libraryBooks = useLiveQuery(() =>
    db.books.filter((b) => !b.deleted_at).toArray(),
  );

  const downloads = useLiveQuery(() =>
    db.downloads.orderBy('created_at').reverse().toArray(),
  );

  const activeDownloadsCount = useMemo(() => {
    return (downloads || []).filter(
      (d) => d.status === 'downloading' || d.status === 'pending',
    ).length;
  }, [downloads]);

  // Active source instance
  const activeSource = useMemo(() => {
    return sources.find((s) => s.id === activeSourceId) || sources[0];
  }, [sources, activeSourceId]);

  // Load available sources
  // Which source the current `sections`/`activeSectionId` belong to. Items are only
  // fetched once this matches the active source, so we never browse source B with
  // a section id left over from source A.
  const [sectionsFor, setSectionsFor] = useState<string | null>(snap?.sourceId ?? null);
  // Per-source filter values (empty string = any).
  const [filters, setFilters] = useState<Record<string, string>>(snap?.filters ?? {});
  const filtersKey = JSON.stringify(filters);
  // Book being fetched by "Read now" (downloads the small edition, then opens it).
  const [readingNow, setReadingNow] = useState<{ id: string; error?: string } | null>(null);

  // Suwayomi Extension Store state
  const [extStoreOpen, setExtStoreOpen] = useState(false);
  const [extensions, setExtensions] = useState<SuwayomiExtension[]>([]);
  const [extSearch, setExtSearch] = useState('');
  const [extLangFilter, setExtLangFilter] = useState('');
  const [extTab, setExtTab] = useState<'installed' | 'available'>('installed');
  const [installingPkg, setInstallingPkg] = useState<string | null>(null);
  const [loadingExts, setLoadingExts] = useState(false);

  const isSuwayomi = Boolean(
    activeSource &&
    (activeSource.id === 'suwayomi' ||
      activeSource.id.startsWith('suwayomi:') ||
      activeSource instanceof SuwayomiSource),
  );

  const installedExts = useMemo(
    () => extensions.filter((e) => e.installed),
    [extensions],
  );
  const availableExts = useMemo(
    () => extensions.filter((e) => !e.installed),
    [extensions],
  );
  const displayedExts = useMemo(() => {
    let list = extTab === 'installed' ? installedExts : availableExts;
    if (extLangFilter) {
      list = list.filter((e) => e.lang === extLangFilter);
    }
    if (!extSearch.trim()) return list;
    const q = extSearch.toLowerCase();
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.pkgName.toLowerCase().includes(q) ||
        e.lang.toLowerCase().includes(q),
    );
  }, [extTab, installedExts, availableExts, extSearch, extLangFilter]);

  const suwayomiSource = useMemo(() => {
    if (!activeSource) return null;
    if (activeSource instanceof SuwayomiSource) return activeSource;
    if (isSuwayomi) {
      const url =
        (activeSource as unknown as { baseUrl?: string; url?: string }).baseUrl ||
        (activeSource as unknown as { baseUrl?: string; url?: string }).url ||
        'http://localhost:4567';
      const key = (activeSource as unknown as { apiKey?: string }).apiKey;
      return new SuwayomiSource(activeSource.id, activeSource.name, url, key);
    }
    return null;
  }, [activeSource, isSuwayomi]);

  // Load extension list when Suwayomi extension dialog opens or source switches to Suwayomi
  useEffect(() => {
    if (!isSuwayomi || !suwayomiSource) return;
    void suwayomiSource.getExtensionList().then((list) => {
      if (list.length > 0) setExtensions(list);
    });
  }, [isSuwayomi, suwayomiSource]);

  useEffect(() => {
    if (!extStoreOpen || !suwayomiSource) return;
    setLoadingExts(true);
    void suwayomiSource
      .getExtensionList()
      .then((list) => setExtensions(list))
      .finally(() => setLoadingExts(false));
  }, [extStoreOpen, suwayomiSource]);

  const handleInstallExtension = async (pkgName: string) => {
    if (!suwayomiSource) return;
    setInstallingPkg(pkgName);
    try {
      const ok = await suwayomiSource.installExtension(pkgName);
      if (ok) {
        const updated = await suwayomiSource.getExtensionList();
        setExtensions(updated);
        const sec = await suwayomiSource.sections(true);
        setSections(sec);
      }
    } finally {
      setInstallingPkg(null);
    }
  };

  const handleUninstallExtension = async (pkgName: string) => {
    if (!suwayomiSource) return;
    setInstallingPkg(pkgName);
    try {
      const ok = await suwayomiSource.uninstallExtension(pkgName);
      if (ok) {
        const updated = await suwayomiSource.getExtensionList();
        setExtensions(updated);
        const sec = await suwayomiSource.sections(true);
        setSections(sec);
      }
    } finally {
      setInstallingPkg(null);
    }
  };

  // Every fetch takes a ticket; only the latest ticket may write results. Without
  // this, a slow response from a previous source (Gutendex can take seconds)
  // landed after the new source's results and replaced them.
  const requestSeq = useRef(0);

  // Switch source: drop the previous source's results right away so they can't
  // linger on screen, and invalidate any request still in flight for it.
  const switchSource = useCallback((id: string) => {
    requestSeq.current++;
    setActiveSourceId(id);
    setFilters({});
    setSectionsFor(null);
    setSections([]);
    setItems([]);
    setNextCursor(undefined);
    setError(null);
    setLoading(true);
  }, []);

  const activeSourceIdRef = useRef(activeSourceId);
  useEffect(() => {
    activeSourceIdRef.current = activeSourceId;
  }, [activeSourceId]);

  const refreshSources = useCallback(async () => {
    const list = await getAllBookSources();
    setSources(list);
    if (list.length > 0 && !list.some((s) => s.id === activeSourceIdRef.current)) {
      switchSource(list[0].id);
    }
  }, [switchSource]);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  // Load sections when source changes
  useEffect(() => {
    if (!activeSource) return;
    let alive = true;
    void (async () => {
      let sec: CatalogSection[] = [];
      try {
        sec = await activeSource.sections();
      } catch {
        sec = [];
      }
      if (!alive) return;
      setSections(sec);
      setActiveSectionId((current) =>
        sec.length > 0 && !sec.some((s) => s.id === current) ? sec[0].id : current,
      );
      setSectionsFor(activeSource.id);
    })();
    return () => {
      alive = false;
    };
  }, [activeSource]);

  const displayedSections = useMemo(() => {
    if (!filters.lang) return sections;
    if (filters.lang === 'en') {
      return sections.filter((s) => s.title.includes('(EN)'));
    }
    if (filters.lang === 'all') {
      return sections.filter((s) => s.title.includes('(ALL)'));
    }
    return sections;
  }, [sections, filters.lang]);

  useEffect(() => {
    if (displayedSections.length > 0 && !displayedSections.some((s) => s.id === activeSectionId)) {
      setActiveSectionId(displayedSections[0].id);
    }
  }, [displayedSections, activeSectionId]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch catalog items (browse or search)
  const fetchItems = useCallback(
    async (source: CatalogSource, sectionId: string, query: string, f: Record<string, string> = {}) => {
      const ticket = ++requestSeq.current;
      const isCurrent = () => ticket === requestSeq.current;
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      try {
        const page = query ? await source.search(query, undefined, f) : await source.browse(sectionId, undefined, f);
        if (!isCurrent()) return;
        setItems(page.items);
        setNextCursor(page.next);
      } catch (err) {
        if (!isCurrent()) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setItems([]);
        setNextCursor(undefined);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeSource || sectionsFor !== activeSource.id) return;
    if (restoredKeyRef.current) {
      const key = JSON.stringify([activeSource.id, activeSectionId, debouncedQuery, JSON.parse(filtersKey)]);
      const skip = key === restoredKeyRef.current;
      restoredKeyRef.current = null;
      if (skip) return;
    }
    if (activeSectionId || debouncedQuery) {
      void fetchItems(activeSource, activeSectionId, debouncedQuery, JSON.parse(filtersKey));
    } else {
      setLoading(false);
    }
  }, [activeSource, sectionsFor, activeSectionId, debouncedQuery, filtersKey, fetchItems]);

  // Load more pages
  const handleLoadMore = async () => {
    if (!activeSource || !nextCursor || loadingMore) return;
    const ticket = requestSeq.current;
    setLoadingMore(true);
    try {
      const page = debouncedQuery
        ? await activeSource.search(debouncedQuery, nextCursor, filters)
        : await activeSource.browse(activeSectionId, nextCursor, filters);
      if (ticket !== requestSeq.current) return;
      setItems((prev) => {
        // Sources sometimes overlap pages; duplicate keys break React reconciliation.
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setNextCursor(page.next);
    } catch (err) {
      if (ticket !== requestSeq.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (ticket === requestSeq.current) setLoadingMore(false);
    }
  };

  // Check if a catalog entry already exists in the local library
  // Indexed once per library change instead of scanning every book for every card.
  const libraryIndex = useMemo(() => {
    const bySourceId = new Map<string, Book>();
    const byTitle = new Map<string, Book[]>();
    for (const b of libraryBooks ?? []) {
      const sourceId = b.meta?.source?.id;
      if (sourceId) bySourceId.set(sourceId, b);
      const key = b.title.toLowerCase().trim();
      const list = byTitle.get(key);
      if (list) list.push(b);
      else byTitle.set(key, [b]);
    }
    return { bySourceId, byTitle };
  }, [libraryBooks]);

  const getLibraryBook = useCallback(
    (entry: CatalogEntry) => {
      const bySource = libraryIndex.bySourceId.get(entry.id);
      if (bySource) return bySource;
      const entryAuthor = (entry.authors[0] || '').toLowerCase().trim();
      return libraryIndex.byTitle
        .get(entry.title.toLowerCase().trim())
        ?.find((b) => !entryAuthor || b.author.toLowerCase().trim() === entryAuthor);
    },
    [libraryIndex],
  );

  // Check if a book is currently downloading
  const getDownloadStatus = useCallback(
    (entry: CatalogEntry): DownloadItem | undefined => {
      if (!downloads) return undefined;
      const dlId = `dl:${entry.id}`;
      return downloads.find((d) => d.id === dlId);
    },
    [downloads],
  );

  // Enqueue download
  // Continuous scrolling: load the next page when the end of the grid comes near.
  const loadMoreRef = useRef<() => void>(() => {});
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // "Read now": an EPUB is one file, so it can't be streamed page by page like
  // manga; instead fetch the small text edition and open it as soon as it lands.
  const handleReadNow = async (entry: CatalogEntry) => {
    if (!activeSource) return;
    setReadingNow({ id: entry.id });
    const downloadId = await downloadManager.enqueue(entry, activeSource);
    for (let i = 0; i < 600; i++) {
      const dl = await db.downloads.get(downloadId);
      if (dl?.status === 'completed') {
        const book = await db.books.filter((b) => !b.deleted_at && b.meta?.source?.id === entry.id).first();
        if (book) {
          setReadingNow(null);
          setSelectedBook(null);
          navigate(`/read/${book.id}`);
          return;
        }
      }
      if (dl?.status === 'failed' || dl?.status === 'cancelled') {
        setReadingNow({ id: entry.id, error: dl.error || 'Download failed' });
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    setReadingNow({ id: entry.id, error: 'Timed out waiting for the download.' });
  };

  const handleDownload = async (entry: CatalogEntry) => {
    if (!activeSource) return;
    await downloadManager.enqueue(entry, activeSource);
  };

  // Add custom source submission
  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim() || !newSourceUrl.trim()) return;
    setAddSourceLoading(true);
    setAddSourceError(null);
    try {
      let src: CatalogSource;
      if (newSourceKind === 'suwayomi') {
        src = await addCustomSuwayomiSource({
          name: newSourceName.trim(),
          url: newSourceUrl.trim(),
          apiKey: newSourceApiKey.trim() || undefined,
        });
      } else if (newSourceKind === 'komga') {
        src = await addCustomKomgaSource({
          name: newSourceName.trim(),
          url: newSourceUrl.trim(),
          username: newSourceUser.trim() || undefined,
          password: newSourcePass.trim() || undefined,
          apiKey: newSourceApiKey.trim() || undefined,
        });
      } else {
        src = await addCustomOpdsSource({
          name: newSourceName.trim(),
          url: newSourceUrl.trim(),
          username: newSourceUser.trim() || undefined,
          password: newSourcePass.trim() || undefined,
          apiKey: newSourceApiKey.trim() || undefined,
        });
      }
      await refreshSources();
      switchSource(src.id);
      setAddSourceOpen(false);
      setNewSourceName('');
      setNewSourceUrl('');
      setNewSourceUser('');
      setNewSourcePass('');
      setNewSourceApiKey('');
    } catch (err) {
      setAddSourceError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddSourceLoading(false);
    }
  };

  // Delete custom source
  const handleDeleteSource = async (sourceId: string) => {
    await removeCustomSource(sourceId);
    await refreshSources();
  };

  const latest = useRef<Omit<StoreSnapshot, 'scrollTop'> | null>(null);
  latest.current = {
    sourceId: activeSourceId,
    sectionId: activeSectionId,
    query: debouncedQuery,
    filters,
    sections,
    items,
    nextCursor,
  };
  const scroller = () =>
    rootRef.current?.querySelector<HTMLElement>('[data-testid="pull-to-refresh-container"]') ?? null;
  useEffect(() => {
    const el = scroller();
    let scrollTop = snap?.scrollTop ?? 0;
    if (el && scrollTop) el.scrollTop = scrollTop;
    // Track continuously: once unmounted the element is detached and reports 0.
    const onScroll = () => {
      scrollTop = el?.scrollTop ?? 0;
    };
    el?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el?.removeEventListener('scroll', onScroll);
      if (latest.current) storeSnapshot = { ...latest.current, scrollTop };
    };
    // Mount/unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  loadMoreRef.current = () => {
    if (!loading && !error) void handleLoadMore();
  };

  return (
    <div ref={rootRef} className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-base)]">
      {/* Top Header & Search Bar */}
      <header className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--stroke)] bg-[var(--layer-1)] flex flex-wrap items-center justify-between gap-3 sm:gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <ShoppingBag className="w-6 h-6 text-[var(--accent)]" />
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-1)]">
            Store
          </h1>
        </div>

        {/* Search input */}
        <div className="w-full sm:w-72 md:w-96 order-3 sm:order-2">
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery('')}
            placeholder={`Search ${activeSource?.name || 'books'}…`}
          />
        </div>

        {/* Right actions: Source selector & Downloads Flyout */}
        <div className="flex items-center gap-2 order-2 sm:order-3">
          {/* Source Selector Dropdown */}
          <div className="flex items-center gap-1.5 bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-md)] px-2 py-1">
            <Layers className="w-4 h-4 text-[var(--text-3)] shrink-0" />
            <select
              id="source-select"
              aria-label="Select book source"
              value={activeSourceId}
              onChange={(e) => {
                switchSource(e.target.value);
                setSearchQuery('');
              }}
              className="bg-transparent text-sm text-[var(--text-1)] outline-none cursor-pointer pr-1"
            >
              {sources.map((s) => (
                <option
                  key={s.id}
                  value={s.id}
                  className="bg-[var(--layer-solid)] text-[var(--text-1)]"
                >
                  {s.name} · {s.kind === 'manga' ? 'Manga' : 'Books'}
                </option>
              ))}
            </select>
          </div>

          {/* Add custom OPDS button */}
          <IconButton
            icon={<Plus className="w-4 h-4" />}
            label="Add custom source"
            variant="subtle"
            onClick={() => setAddSourceOpen(true)}
          />

          {/* Delete active source if custom */}
          {activeSource &&
            !BUILT_IN_SOURCE_IDS.has(activeSource.id) && (
              <IconButton
                icon={<Trash2 className="w-4 h-4 text-[var(--danger)]" />}
                label="Delete this source"
                variant="subtle"
                onClick={() => handleDeleteSource(activeSource.id)}
              />
            )}

          {/* Downloads Flyout Popover */}
          <Popover
            trigger={
              <button
                type="button"
                aria-label={`Downloads (${activeDownloadsCount} active)`}
                className="relative flex items-center justify-center p-2 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] hover:bg-[var(--layer-3)] text-[var(--text-1)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {activeDownloadsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent)] text-[10px] font-bold text-white flex items-center justify-center animate-pulse">
                    {activeDownloadsCount}
                  </span>
                )}
              </button>
            }
          >
            <div className="w-80 max-h-96 flex flex-col">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--stroke)] mb-2">
                <span className="font-semibold text-sm">Downloads</span>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => downloadManager.clearCompleted()}
                >
                  Clear Finished
                </Button>
              </div>

              <div className="overflow-y-auto space-y-2.5 max-h-72 pr-1">
                {(!downloads || downloads.length === 0) && (
                  <p className="text-xs text-[var(--text-3)] text-center py-4">
                    No active or recent downloads
                  </p>
                )}

                {downloads?.map((dl) => (
                  <div
                    key={dl.id}
                    className="p-2 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--text-1)] truncate">
                        {dl.title}
                      </span>
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          dl.status === 'completed'
                            ? 'bg-[var(--success-soft)] text-[var(--success)]'
                            : dl.status === 'downloading'
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : dl.status === 'failed'
                                ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                                : 'bg-[var(--layer-3)] text-[var(--text-3)]'
                        }`}
                      >
                        {dl.status}
                      </span>
                    </div>

                    {(dl.status === 'downloading' || dl.status === 'pending') && (
                      <ProgressBar value={dl.progress * 100} height={4} />
                    )}

                    {dl.error && (
                      <p className="text-[11px] text-[var(--danger)] line-clamp-1">
                        {dl.error}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      {dl.status === 'downloading' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => downloadManager.cancel(dl.id)}
                        >
                          Cancel
                        </Button>
                      )}
                      {(dl.status === 'failed' || dl.status === 'cancelled') && (
                        <Button
                          variant="standard"
                          size="sm"
                          onClick={() => downloadManager.retry(dl.id)}
                        >
                          Retry
                        </Button>
                      )}
                      {dl.status === 'completed' && (
                        <Button
                          variant="accent"
                          size="sm"
                          onClick={() => {
                            const found = libraryBooks?.find(
                              (b) =>
                                b.meta?.source?.id === dl.id.replace(/^dl:/, '') ||
                                b.title.toLowerCase() === dl.title.toLowerCase(),
                            );
                            if (found) {
                              navigate(`/read/${found.id}`);
                            } else {
                              navigate('/library');
                            }
                          }}
                        >
                          Read
                        </Button>
                      )}
                      <IconButton
                        icon={<X className="w-3.5 h-3.5" />}
                        label="Remove download item"
                        variant="subtle"
                        size="sm"
                        onClick={() => downloadManager.remove(dl.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Popover>
        </div>
      </header>

      {/* Sections Bar (only shown when not actively searching) */}
      {((!debouncedQuery && sections.length > 0) || (activeSource?.filters?.length ?? 0) > 0) && (
        <div className="px-4 sm:px-6 py-2 border-b border-[var(--stroke)] bg-[var(--layer-1)] flex items-center gap-2 shrink-0 overflow-x-auto no-scrollbar">
          {activeSource?.filters?.map((f) => (
            <select
              key={f.id}
              aria-label={f.label}
              value={filters[f.id] ?? ''}
              onChange={(e) => setFilters((cur) => ({ ...cur, [f.id]: e.target.value }))}
              className={`h-7 px-2 rounded-[var(--r-md)] border text-xs outline-none cursor-pointer bg-[var(--layer-2)] shrink-0 ${
                filters[f.id] ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--stroke)] text-[var(--text-2)]'
              }`}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value} title={o.hint} className="bg-[var(--layer-solid)] text-[var(--text-1)]">
                  {o.label}
                </option>
              ))}
            </select>
          ))}
          {Object.values(filters).some(Boolean) && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] underline cursor-pointer shrink-0"
            >
              Clear filters
            </button>
          )}
          {!debouncedQuery && displayedSections.length > 0 && (activeSource?.filters?.length ?? 0) > 0 && (
            <span className="w-px h-5 bg-[var(--stroke)] mx-1 hidden sm:block shrink-0" aria-hidden="true" />
          )}

          {!debouncedQuery && displayedSections.length > 8 ? (
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <select
                aria-label="Select source or section"
                value={activeSectionId}
                onChange={(e) => setActiveSectionId(e.target.value)}
                className="h-7.5 max-w-[180px] sm:max-w-xs px-2.5 rounded-[var(--r-md)] border border-[var(--stroke)] text-xs font-medium outline-none cursor-pointer bg-[var(--layer-2)] text-[var(--text-1)] focus:border-[var(--accent)] shrink-0"
              >
                {displayedSections.map((sec) => (
                  <option key={sec.id} value={sec.id} className="bg-[var(--layer-solid)] text-[var(--text-1)]">
                    {sec.title}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {displayedSections.slice(0, 8).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSectionId(sec.id)}
                    className={`px-2.5 py-1 rounded-[var(--r-md)] text-xs font-medium transition-all shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      activeSectionId === sec.id
                        ? 'bg-[var(--accent)] text-white font-semibold shadow-sm'
                        : 'bg-[var(--layer-2)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-3)]'
                    }`}
                  >
                    {sec.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            !debouncedQuery && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {displayedSections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSectionId(sec.id)}
                    className={`px-3 py-1.5 rounded-[var(--r-md)] text-xs font-medium transition-all shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      activeSectionId === sec.id
                        ? 'bg-[var(--accent)] text-white font-semibold shadow-sm'
                        : 'bg-[var(--layer-2)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-3)]'
                    }`}
                  >
                    {sec.title}
                  </button>
                ))}
              </div>
            )
          )}

          {isSuwayomi && (
            <button
              type="button"
              onClick={() => setExtStoreOpen(true)}
              className="ml-auto px-3 py-1.5 rounded-[var(--r-md)] text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              title="Manage and install extensions from the Suwayomi Extension Store"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Extensions ({installedExts.length > 0 ? installedExts.length : 'Store'})</span>
            </button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <PullToRefresh
        onRefresh={async () => {
          if (activeSource) {
            await fetchItems(activeSource, activeSectionId, debouncedQuery, filters);
          }
        }}
        className="flex-1 px-4 sm:px-6 py-4"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <ProgressRing size={32} />
            <p className="text-sm text-[var(--text-3)]">
              Loading {activeSource?.name || 'catalog'}…
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center max-w-md mx-auto">
            <AlertCircle className="w-10 h-10 text-[var(--danger)]" />
            <h3 className="text-base font-semibold text-[var(--text-1)]">
              Unable to load catalog
            </h3>
            <p className="text-sm text-[var(--text-2)]">{error}</p>
            <Button
              variant="standard"
              onClick={() =>
                activeSource &&
                fetchItems(activeSource, activeSectionId, debouncedQuery, filters)
              }
            >
              <RotateCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="w-12 h-12 text-[var(--text-3)]" />}
            title={debouncedQuery ? 'No results found' : 'No books in this section'}
            description={
              debouncedQuery
                ? `No books matching "${debouncedQuery}" were found in ${activeSource?.name}.`
                : 'Try browsing another section or searching for titles.'
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            <CoverGrid columnWidth={150}>
              {items.map((item) => {
                const owned = getLibraryBook(item);
                return (
                  <div key={item.id} className="relative group cursor-pointer">
                    <BookCard
                      id={item.id}
                      title={item.title}
                      author={item.authors.join(', ') || 'Unknown'}
                      coverUrl={item.cover}
                      onClick={() => setSelectedBook(item)}
                      badge={
                        owned || isAdultRating(item.contentRating) ? (
                          <span className="flex items-center gap-1">
                            {isAdultRating(item.contentRating) && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--danger)] text-white shadow-sm">
                                18+
                              </span>
                            )}
                            {owned && (
                              <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white shadow-sm">
                                <Check className="w-3 h-3" />
                                In Library
                              </span>
                            )}
                          </span>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })}
            </CoverGrid>

            {/* Continuous scroll: the next page loads as this comes into view. */}
            {nextCursor && (
              <div ref={sentinelRef} className="flex justify-center items-center gap-2 pb-8 pt-2 text-xs text-[var(--text-3)] min-h-10">
                {loadingMore && (
                  <>
                    <ProgressRing size={16} /> Loading more…
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </PullToRefresh>

      {/* Book Details Modal */}
      {selectedBook && (
        <Dialog
          open={Boolean(selectedBook)}
          onOpenChange={(open) => !open && setSelectedBook(null)}
          title={selectedBook.title}
        >
          <div className="flex flex-row flex-wrap sm:flex-nowrap gap-4 sm:gap-5 p-1">
            {/* Book Cover: beside the details on phones, not a full-width block */}
            <div className="w-24 sm:w-36 md:w-44 shrink-0 self-start">
              {selectedBook.cover ? (
                <img
                  src={selectedBook.cover}
                  alt={selectedBook.title}
                  className="w-full aspect-[2/3] object-cover rounded-[var(--r-cover)] shadow-[var(--shadow-cover)]"
                />
              ) : (
                <div className="w-full aspect-[2/3] rounded-[var(--r-cover)] bg-[var(--layer-2)] border border-[var(--stroke)] flex items-center justify-center text-[var(--text-3)] text-xs text-center p-2">
                  No Cover
                </div>
              )}
            </div>

            {/* Book Details */}
            <div className="flex-1 basis-40 flex flex-col gap-3 min-w-0">
              <div>
                <h3 className="sr-only">
                  {selectedBook.title}
                </h3>
                <p className="text-sm text-[var(--text-2)] mt-0.5">
                  {selectedBook.authors.join(', ') || 'Unknown Author'}
                </p>
                {selectedBook.languages && selectedBook.languages.length > 0 && (
                  <p className="text-xs text-[var(--text-3)] mt-1 uppercase">
                    Language: {selectedBook.languages.join(', ')}
                  </p>
                )}
              </div>

              {/* Tags / Subjects */}
              {selectedBook.tags && selectedBook.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedBook.tags.slice(0, 6).map((tag, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--layer-3)] text-[var(--text-2)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Description / Summary rendered safely with DOMParser */}
              {selectedBook.summary && (
                <div className="text-xs text-[var(--text-2)] leading-relaxed max-h-40 overflow-y-auto pr-2 border-t border-[var(--stroke)] pt-2">
                  {safeHtml(selectedBook.summary)}
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-auto pt-3 border-t border-[var(--stroke)] flex flex-wrap items-center gap-3">
                {(() => {
                  const owned = getLibraryBook(selectedBook);
                  const dl = getDownloadStatus(selectedBook);

                  if (owned) {
                    return (
                      <Button
                        variant="accent"
                        onClick={() => {
                          setSelectedBook(null);
                          navigate(`/read/${owned.id}`);
                        }}
                      >
                        <BookOpen className="w-4 h-4 mr-2" />
                        Read Now
                      </Button>
                    );
                  }

                  if (dl?.status === 'downloading' || dl?.status === 'pending') {
                    return (
                      <div className="flex items-center gap-3 w-full">
                        <div className="flex-1">
                          <ProgressBar value={dl.progress * 100} height={6} />
                          <p className="text-[11px] text-[var(--text-3)] mt-1">
                            Downloading… {Math.round(dl.progress * 100)}%
                          </p>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => downloadManager.cancel(dl.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    );
                  }

                  if (selectedBook.kind === 'manga') {
                    return (
                      <Button
                        variant="accent"
                        onClick={() => {
                          setSelectedBook(null);
                          navigate(`/series/${encodeURIComponent(selectedBook.id)}`);
                        }}
                      >
                        <BookOpen className="w-4 h-4 mr-2" />
                        View Series & Chapters
                      </Button>
                    );
                  }

                  const hasEpub = (selectedBook.formats ?? []).some((f) => f.mime === 'application/epub+zip');

                  if (!hasEpub) {
                    const isOl = selectedBook.id.startsWith('openlibrary:');
                    return (
                      <div className="flex flex-col gap-2 w-full">
                        <div className="p-3 bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-md)] text-xs text-[var(--text-2)] flex flex-col gap-1.5">
                          <span className="font-semibold text-[var(--text-1)]">
                            {isOl ? 'Digital Lending Library Title' : 'No Downloadable Edition'}
                          </span>
                          <p>
                            {isOl
                              ? 'This title is protected by copyright and is available for loan-based borrowing directly on Open Library. Public domain DRM-free EPUB downloads are not available.'
                              : 'This title does not have a direct EPUB download available from this source.'}
                          </p>
                          {isOl && (
                            <a
                              href={`https://openlibrary.org/works/${selectedBook.id.replace(/^openlibrary:/, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline mt-0.5"
                            >
                              Borrow or View on Open Library <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const primaryFormat = selectedBook.formats?.[0];
                  const otherFormats = (selectedBook.formats ?? []).slice(1);

                  return (
                    <>
                      <Button
                        variant="accent"
                        disabled={readingNow?.id === selectedBook.id && !readingNow.error}
                        onClick={() => {
                          void handleReadNow(selectedBook);
                        }}
                      >
                        <BookOpen className="w-4 h-4 mr-2" />
                        {readingNow?.id === selectedBook.id && !readingNow.error ? 'Opening…' : 'Read now'}
                      </Button>
                      <Button
                        variant="standard"
                        onClick={() => {
                          void handleDownload(selectedBook);
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {primaryFormat?.label ? `Download (${primaryFormat.label.split('(')[0].trim()})` : 'Download'}
                      </Button>
                      {readingNow?.id === selectedBook.id && readingNow.error && (
                        <p className="basis-full text-xs text-[var(--danger)]">{readingNow.error}</p>
                      )}
                      {otherFormats.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 basis-full mt-1 pt-2 border-t border-[var(--stroke)]/50">
                          <span className="text-[11px] text-[var(--text-3)] font-medium">Other formats:</span>
                          {otherFormats.map((fmt) => (
                            <Button
                              key={fmt.url}
                              variant="standard"
                              size="sm"
                              title={`Download ${fmt.label || fmt.mime}`}
                              onClick={() => {
                                if (activeSource) void downloadManager.enqueue(selectedBook, activeSource, fmt.url);
                              }}
                            >
                              <Download className="w-3.5 h-3.5 mr-1" />
                              {fmt.label || (fmt.mime.includes('pdf') ? 'PDF' : fmt.mime.includes('comic') ? 'CBZ' : 'EPUB')}
                            </Button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

                <Button
                  variant="subtle"
                  onClick={() => setSelectedBook(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {/* Add Custom Source Dialog */}
      <Dialog
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        title="Add Custom Source"
      >
        <form onSubmit={handleAddSource} className="flex flex-col gap-4 py-1">
          {/* Source Type Selector */}
          <div>
            <span className="block text-xs font-semibold text-[var(--text-2)] mb-1.5">Source Type</span>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-md)]">
              <button
                type="button"
                onClick={() => {
                  setNewSourceKind('opds');
                  if (!newSourceName || newSourceName.includes('Suwayomi') || newSourceName.includes('Komga')) {
                    setNewSourceName('Custom OPDS');
                    setNewSourceUrl('');
                  }
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-[var(--r-sm)] transition-colors cursor-pointer ${
                  newSourceKind === 'opds'
                    ? 'bg-[var(--layer-1)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                OPDS (Books)
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewSourceKind('suwayomi');
                  if (!newSourceName || newSourceName === 'Custom OPDS' || newSourceName.includes('Komga')) {
                    setNewSourceName('Suwayomi (Tachiyomi)');
                    setNewSourceUrl('http://localhost:4567');
                  }
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-[var(--r-sm)] transition-colors cursor-pointer ${
                  newSourceKind === 'suwayomi'
                    ? 'bg-[var(--layer-1)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                Suwayomi / Mihon
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewSourceKind('komga');
                  if (!newSourceName || newSourceName === 'Custom OPDS' || newSourceName.includes('Suwayomi')) {
                    setNewSourceName('Komga Server');
                    setNewSourceUrl('http://localhost:25600');
                  }
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-[var(--r-sm)] transition-colors cursor-pointer ${
                  newSourceKind === 'komga'
                    ? 'bg-[var(--layer-1)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                Komga Server
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <span className="block text-xs font-semibold text-[var(--text-2)] mb-1.5">Quick Presets</span>
            <div className="flex flex-wrap gap-2">
              {SOURCE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.about}
                  onClick={() => {
                    setNewSourceKind(preset.kind);
                    setNewSourceName(preset.name);
                    setNewSourceUrl(preset.url);
                  }}
                  className={`px-2.5 py-1 rounded-[var(--r-md)] border text-xs cursor-pointer transition-colors ${
                    newSourceUrl === preset.url
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                      : 'border-[var(--stroke)] bg-[var(--layer-2)] text-[var(--text-1)] hover:border-[var(--accent)]'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {addSourceError && (
            <div className="p-2.5 rounded-[var(--r-md)] bg-[var(--danger-soft)] text-[var(--danger)] text-xs">
              {addSourceError}
            </div>
          )}

          <div>
            <label
              htmlFor="source-name-input"
              className="block text-xs font-semibold text-[var(--text-2)] mb-1"
            >
              Source Name
            </label>
            <input
              id="source-name-input"
              type="text"
              required
              placeholder={
                newSourceKind === 'suwayomi'
                  ? 'e.g. My Suwayomi Server'
                  : newSourceKind === 'komga'
                    ? 'e.g. My Komga Server'
                    : 'e.g. Calibre OPDS, Standard Ebooks'
              }
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              className="w-full h-9 px-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label
              htmlFor="source-url-input"
              className="block text-xs font-semibold text-[var(--text-2)] mb-1"
            >
              {newSourceKind === 'suwayomi'
                ? 'Suwayomi Server URL'
                : newSourceKind === 'komga'
                  ? 'Komga Server URL'
                  : 'OPDS Catalog URL'}
            </label>
            <input
              id="source-url-input"
              type="url"
              required
              placeholder={
                newSourceKind === 'suwayomi'
                  ? 'http://localhost:4567'
                  : newSourceKind === 'komga'
                    ? 'http://localhost:25600'
                    : 'https://example.com/opds'
              }
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
            <p className="text-[11px] text-[var(--text-3)] mt-1">
              {newSourceKind === 'suwayomi'
                ? 'Connects to Suwayomi-Server (Tachidesk). All installed Tachiyomi and Mihon extensions become available in Verso.'
                : newSourceKind === 'komga'
                  ? 'Connects to your self-hosted Komga comics and manga server.'
                  : 'Connects to standard OPDS 1.2 or 2.0 feeds (Calibre, Kavita, Unglue.it, etc.).'}
            </p>
          </div>

          <div className="border-t border-[var(--stroke)] pt-3">
            <span className="block text-xs font-medium text-[var(--text-3)] mb-2">
              Authentication (Optional)
            </span>
            {newSourceKind !== 'suwayomi' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2.5">
                <div>
                  <label
                    htmlFor="source-user-input"
                    className="block text-[11px] text-[var(--text-2)] mb-1"
                  >
                    Username
                  </label>
                  <input
                    id="source-user-input"
                    type="text"
                    placeholder="Optional username"
                    value={newSourceUser}
                    onChange={(e) => setNewSourceUser(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="source-pass-input"
                    className="block text-[11px] text-[var(--text-2)] mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="source-pass-input"
                    type="password"
                    placeholder="Optional password"
                    value={newSourcePass}
                    onChange={(e) => setNewSourcePass(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="source-key-input"
                className="block text-[11px] text-[var(--text-2)] mb-1"
              >
                API Key / Bearer Token
              </label>
              <input
                id="source-key-input"
                type="text"
                placeholder="Optional token"
                value={newSourceApiKey}
                onChange={(e) => setNewSourceApiKey(e.target.value)}
                className="w-full h-8 px-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--stroke)]">
            <Button
              variant="subtle"
              type="button"
              onClick={() => setAddSourceOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              type="submit"
              disabled={addSourceLoading || !newSourceName || !newSourceUrl}
            >
              {addSourceLoading ? 'Adding…' : 'Add Source'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Suwayomi Extension Store Modal */}
      <Dialog
        open={extStoreOpen}
        onClose={() => setExtStoreOpen(false)}
        title="Suwayomi Extensions (Tachiyomi & Mihon Store)"
        className="max-w-xl"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-2)]">
            Installed Tachiyomi and Mihon extensions from your local Suwayomi server. Install new sources from the Keiyoushi Extension Store to read in Verso.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px]">
              <input
                type="text"
                value={extSearch}
                onChange={(e) => setExtSearch(e.target.value)}
                placeholder="Search extensions (e.g. Manga, Webtoons, English)..."
                className="w-full h-8 px-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <select
              aria-label="Filter extensions by language"
              value={extLangFilter}
              onChange={(e) => setExtLangFilter(e.target.value)}
              className="h-8 px-2.5 rounded-[var(--r-md)] border border-[var(--stroke)] text-xs bg-[var(--layer-2)] text-[var(--text-1)] outline-none cursor-pointer shrink-0"
            >
              <option value="">All Languages</option>
              <option value="en">English (EN)</option>
              <option value="all">Multi (ALL)</option>
            </select>
            <div className="flex rounded-[var(--r-md)] bg-[var(--layer-2)] p-0.5 border border-[var(--stroke)] text-xs shrink-0">
              <button
                type="button"
                onClick={() => setExtTab('installed')}
                className={`px-3 py-1 rounded-[var(--r-sm)] font-medium transition-all cursor-pointer ${
                  extTab === 'installed'
                    ? 'bg-[var(--layer-solid)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                Installed ({installedExts.length})
              </button>
              <button
                type="button"
                onClick={() => setExtTab('available')}
                className={`px-3 py-1 rounded-[var(--r-sm)] font-medium transition-all cursor-pointer ${
                  extTab === 'available'
                    ? 'bg-[var(--layer-solid)] text-[var(--text-1)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                Available ({availableExts.length})
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
            {loadingExts ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2">
                <ProgressRing size={24} />
                <span className="text-xs text-[var(--text-3)]">Loading extensions from Suwayomi…</span>
              </div>
            ) : displayedExts.length === 0 ? (
              <p className="text-xs text-[var(--text-3)] text-center py-8">
                {extSearch ? 'No extensions matching your search' : 'No extensions found'}
              </p>
            ) : (
              displayedExts.slice(0, 100).map((ext) => (
                <div
                  key={ext.pkgName}
                  className="p-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex items-center gap-2.5">
                    {ext.iconUrl ? (
                      <img
                        src={
                          activeSource instanceof SuwayomiSource
                            ? `${activeSource.baseUrl}${ext.iconUrl.startsWith('/') ? '' : '/'}${ext.iconUrl}`
                            : ext.iconUrl
                        }
                        alt={ext.name}
                        className="w-8 h-8 rounded-[var(--r-sm)] object-contain bg-[var(--layer-3)] shrink-0"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-[var(--r-sm)] bg-[var(--layer-3)] flex items-center justify-center text-xs font-bold shrink-0 text-[var(--text-2)]">
                        {ext.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-[var(--text-1)] truncate">
                          {ext.name}
                        </span>
                        <span className="text-[10px] px-1 py-0.2 rounded bg-[var(--layer-3)] text-[var(--text-2)] font-mono">
                          {ext.lang.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-[var(--text-3)] font-mono">
                          v{ext.versionName}
                        </span>
                        {ext.isNsfw && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-[var(--danger-soft)] text-[var(--danger)] font-bold">
                            18+
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-3)] truncate font-mono">
                        {ext.pkgName}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {ext.installed ? (
                      <Button
                        variant="subtle"
                        size="sm"
                        disabled={installingPkg === ext.pkgName}
                        onClick={() => handleUninstallExtension(ext.pkgName)}
                      >
                        {installingPkg === ext.pkgName ? 'Removing…' : 'Uninstall'}
                      </Button>
                    ) : (
                      <Button
                        variant="accent"
                        size="sm"
                        disabled={installingPkg === ext.pkgName}
                        onClick={() => handleInstallExtension(ext.pkgName)}
                      >
                        {installingPkg === ext.pkgName ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--stroke)] text-xs text-[var(--text-3)]">
            <span>Powered by Suwayomi Server & Keiyoushi Repository</span>
            <Button variant="subtle" onClick={() => setExtStoreOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
