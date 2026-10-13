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
} from 'lucide-react';
import { db, type Book, type DownloadItem } from '../db';
import {
  getAllBookSources,
  addCustomOpdsSource,
  removeCustomSource,
} from '../sources/registry';
import type {
  CatalogEntry,
  CatalogSection,
  CatalogSource,
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

export default function Store() {
  const navigate = useNavigate();

  // Sources
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>('gutenberg');
  const [sections, setSections] = useState<CatalogSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string>('popular');

  // Search & Catalog items
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [selectedBook, setSelectedBook] = useState<CatalogEntry | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
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
  const [sectionsFor, setSectionsFor] = useState<string | null>(null);

  // Every fetch takes a ticket; only the latest ticket may write results. Without
  // this, a slow response from a previous source (Gutendex can take seconds)
  // landed after the new source's results and replaced them.
  const requestSeq = useRef(0);

  // Switch source: drop the previous source's results right away so they can't
  // linger on screen, and invalidate any request still in flight for it.
  const switchSource = useCallback((id: string) => {
    requestSeq.current++;
    setActiveSourceId(id);
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

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch catalog items (browse or search)
  const fetchItems = useCallback(
    async (source: CatalogSource, sectionId: string, query: string) => {
      const ticket = ++requestSeq.current;
      const isCurrent = () => ticket === requestSeq.current;
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      try {
        const page = query ? await source.search(query) : await source.browse(sectionId);
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
    if (activeSectionId || debouncedQuery) {
      void fetchItems(activeSource, activeSectionId, debouncedQuery);
    } else {
      setLoading(false);
    }
  }, [activeSource, sectionsFor, activeSectionId, debouncedQuery, fetchItems]);

  // Load more pages
  const handleLoadMore = async () => {
    if (!activeSource || !nextCursor || loadingMore) return;
    const ticket = requestSeq.current;
    setLoadingMore(true);
    try {
      const page = debouncedQuery
        ? await activeSource.search(debouncedQuery, nextCursor)
        : await activeSource.browse(activeSectionId, nextCursor);
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
      const src = await addCustomOpdsSource({
        name: newSourceName.trim(),
        url: newSourceUrl.trim(),
        username: newSourceUser.trim() || undefined,
        password: newSourcePass.trim() || undefined,
        apiKey: newSourceApiKey.trim() || undefined,
      });
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-base)]">
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
                  {s.name}
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
            activeSource.id !== 'gutenberg' &&
            activeSource.id !== 'standardebooks' && (
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
      {!debouncedQuery && sections.length > 0 && (
        <div className="px-4 sm:px-6 py-2.5 border-b border-[var(--stroke)] bg-[var(--layer-1)] flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          {sections.map((sec) => (
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
      )}

      {/* Main Content Area */}
      <PullToRefresh
        onRefresh={async () => {
          if (activeSource) {
            await fetchItems(activeSource, activeSectionId, debouncedQuery);
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
                fetchItems(activeSource, activeSectionId, debouncedQuery)
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
                        owned ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white shadow-sm">
                            <Check className="w-3 h-3" />
                            In Library
                          </span>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })}
            </CoverGrid>

            {/* Load More Button */}
            {nextCursor && (
              <div className="flex justify-center pb-8 pt-2">
                <Button
                  variant="standard"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <span className="flex items-center gap-2">
                      <ProgressRing size={16} /> Loading more…
                    </span>
                  ) : (
                    'Load More'
                  )}
                </Button>
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
          <div className="flex flex-col md:flex-row gap-5 max-h-[75vh] overflow-y-auto p-1">
            {/* Book Cover */}
            <div className="w-36 md:w-44 shrink-0 mx-auto md:mx-0">
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
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-1)] leading-snug">
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

                  const illustrated = selectedBook.formats?.find((f) => f.label === 'With illustrations');
                  return (
                    <>
                      <Button
                        variant="accent"
                        onClick={() => {
                          void handleDownload(selectedBook);
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download EPUB
                      </Button>
                      {illustrated && (
                        <Button
                          variant="standard"
                          title="Includes the book's illustrations; can be many times larger"
                          onClick={() => {
                            if (activeSource) void downloadManager.enqueue(selectedBook, activeSource, illustrated.url);
                          }}
                        >
                          With illustrations
                        </Button>
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
        title="Add Custom Source (OPDS)"
      >
        <form onSubmit={handleAddSource} className="flex flex-col gap-4 py-1">
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
              placeholder="e.g. Calibre OPDS, Standard Ebooks"
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
              OPDS Catalog URL
            </label>
            <input
              id="source-url-input"
              type="url"
              required
              placeholder="https://example.com/opds"
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="border-t border-[var(--stroke)] pt-3">
            <span className="block text-xs font-medium text-[var(--text-3)] mb-2">
              Authentication (Optional)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            <div className="mt-2.5">
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
    </div>
  );
}
