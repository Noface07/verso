import { useMemo, useState, useCallback, useRef, useEffect, Fragment } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen,
  Heart,
  LayoutGrid,
  Rows3,
  SlidersHorizontal,
  ArrowUpDown,
  Plus,
  Trash2,
  FolderPlus,
  MoreVertical,
  CheckCircle,
  FileText,
  ChevronDown,
  Edit3,
  CheckSquare,
  Folder,
  Upload,
  BookMarked,
  Sparkles,
} from 'lucide-react';
import {
  db,
  dirty,
  uid,
  deviceId,
  type Book,
  type Progress,
  type Collection,
  type CollectionBook,
} from '../db';
import { fmtBytes, fmtDate, fmtMinutes } from '../lib/format';
import { formatDuration } from '../lib/stats-engine';
import { toggleFavorite, useFavoriteIds, setFavorite } from '../lib/favourites';
import { exportBooks } from '../lib/exportZip';
import { importFiles, ACCEPT } from '../lib/importBook';
import { searchFullText } from '../lib/fullTextSearch';
import { CommandBar } from '../design/components/CommandBar';
import { SegmentedControl } from '../design/components/SegmentedControl';
import { SearchBox } from '../design/components/SearchBox';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { Dropdown, type DropdownMenuSection } from '../design/components/Dropdown';
import { ContextMenu } from '../design/components/ContextMenu';
import { Dialog } from '../design/components/Dialog';
import { CoverGrid } from '../design/components/CoverGrid';
import { isFollowedSeries } from '../lib/series';
import { confirmAction } from '../lib/tauri';
import { BookCard } from '../design/components/BookCard';
import { EmptyState } from '../design/components/EmptyState';
import { BulkActionBar } from '../design/components/BulkActionBar';
import { BulkCollectionDialog } from '../design/components/BulkCollectionDialog';
import { EditMetadataDialog } from '../design/components/EditMetadataDialog';
import { SeriesDetailView } from '../design/components/SeriesDetailView';
import { DuplicateDialog } from '../design/components/DuplicateDialog';
import {
  ImportProgressDialog,
  type FileImportStatus,
} from '../design/components/ImportProgressDialog';
import type { ShellContext } from '../components/Shell';

type SortKey = 'recent' | 'added' | 'title' | 'author' | 'progress' | 'series';
type FilterKey = 'all' | 'favorites' | 'reading' | 'unread' | 'finished';
type FormatType = 'all' | 'books' | 'manga' | 'comics';

export default function Library() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { importing: shellImporting } = useOutletContext<ShellContext>();

  const books = useLiveQuery(
    () => db.books.filter((b) => !b.deleted_at).toArray(),
    [],
    [] as Book[],
  );
  const followedSeries = useLiveQuery(
    () => db.series.filter((s) => isFollowedSeries(s)).toArray(),
    [],
    [],
  );
  const progressRows = useLiveQuery(() => db.progress.toArray(), [], [] as Progress[]);
  const collections = useLiveQuery(
    () => db.collections.filter((c) => !c.deleted_at).toArray(),
    [],
    [] as Collection[],
  );
  const collectionBooks = useLiveQuery(
    () => db.collection_books.filter((cb) => !cb.deleted_at).toArray(),
    [],
    [] as CollectionBook[],
  );
  const favIds = useFavoriteIds();

  // Search & Filters
  const [query, setQuery] = useState('');
  const [searchInside, setSearchInside] = useState(false);
  const [ftsMatchingIds, setFtsMatchingIds] = useState<Set<string>>(new Set());
  const [formatType, setFormatType] = useState<FormatType>(() => {
    const f = params.get('format') as FormatType | null;
    return f && ['all', 'books', 'manga', 'comics'].includes(f) ? f : 'all';
  });
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [filter, setFilter] = useState<FilterKey>(() => {
    const f = params.get('filter') as FilterKey | null;
    return f ?? 'all';
  });
  const [sort, setSort] = useState<SortKey>(() => {
    const s = (params.get('sort') ?? localStorage.getItem('folio_lib_sort')) as SortKey | null;
    return s ?? 'recent';
  });
  const [layout, setLayout] = useState<'grid' | 'list' | 'compact'>(() => {
    return (
      (localStorage.getItem('folio_lib_layout') as 'grid' | 'list' | 'compact') || 'grid'
    );
  });

  // Dialog & Detail states
  const [detailsBook, setDetailsBook] = useState<Book | null>(null);
  const [editingMetadataBook, setEditingMetadataBook] = useState<Book | null>(null);
  const [viewingSeries, setViewingSeries] = useState<{
    name: string;
    books: Book[];
  } | null>(null);

  // Collection modal states
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [renameCollectionOpen, setRenameCollectionOpen] = useState(false);
  const [renameCollectionName, setRenameCollectionName] = useState('');
  const [deleteCollectionOpen, setDeleteCollectionOpen] = useState(false);

  // Multi-selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCollectionOpen, setBulkCollectionOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);

  // Import Dialog & Duplicate States
  const [importStatuses, setImportStatuses] = useState<FileImportStatus[]>([]);
  const [importProgressOpen, setImportProgressOpen] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [duplicateResolution, setDuplicateResolution] = useState<{
    existing: Book;
    newFile: File;
    resolve: (d: 'replace' | 'keep-both' | 'skip') => void;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const progress = useMemo(
    () => new Map(progressRows.map((p) => [p.id, p])),
    [progressRows],
  );
  const pct = useCallback((b: Book) => progress.get(b.id)?.percent ?? 0, [progress]);

  // Full-text search trigger
  useEffect(() => {
    if (!searchInside || !query.trim()) {
      setFtsMatchingIds(new Set());
      return;
    }
    let alive = true;
    void searchFullText(query).then((ids) => {
      if (alive) setFtsMatchingIds(ids);
    });
    return () => {
      alive = false;
    };
  }, [query, searchInside]);

  // Filter & Sort list
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = books.filter((b) => {
      // Format segmented filter
      if (formatType === 'comics' && b.format !== 'CBZ' && b.format !== 'CBR') return false;
      if (formatType === 'books' && (b.format === 'CBZ' || b.format === 'CBR')) return false;

      // Collection filter
      if (selectedCollection === 'favorites') {
        if (!favIds.has(b.id)) return false;
      } else if (selectedCollection !== 'all') {
        const inCol = collectionBooks.some(
          (cb) => cb.collection_id === selectedCollection && cb.book_id === b.id,
        );
        if (!inCol) return false;
      }

      // Search query filter (title, author, series, tags, description, or full-text)
      if (q) {
        const metaFields = `${b.title} ${b.author} ${b.meta.series ?? ''} ${(
          b.meta.tags ?? []
        ).join(' ')} ${b.meta.description ?? ''}`.toLowerCase();
        const matchesMeta = metaFields.includes(q);
        const matchesFts = searchInside && ftsMatchingIds.has(b.id);
        if (!matchesMeta && !matchesFts) return false;
      }

      // Reading status filter
      const p = progress.get(b.id)?.percent ?? 0;
      const isFinished = p >= 0.99 || !!b.meta.finished_at;
      if (filter === 'favorites') return favIds.has(b.id);
      if (filter === 'reading') return p > 0 && !isFinished;
      if (filter === 'unread') return p === 0 && !isFinished;
      if (filter === 'finished') return isFinished;
      return true;
    });

    const cmp: Record<SortKey, (a: Book, b: Book) => number> = {
      recent: (a, b) =>
        (b.last_opened_at ?? b.added_at) - (a.last_opened_at ?? a.added_at),
      added: (a, b) => b.added_at - a.added_at,
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) =>
        a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
      progress: (a, b) =>
        (progress.get(b.id)?.percent ?? 0) - (progress.get(a.id)?.percent ?? 0),
      series: (a, b) => {
        const sa = a.meta.series ?? '';
        const sb = b.meta.series ?? '';
        if (sa && !sb) return -1;
        if (!sa && sb) return 1;
        if (sa !== sb) return sa.localeCompare(sb);
        return (a.meta.series_number ?? 0) - (b.meta.series_number ?? 0);
      },
    };

    return list.sort(cmp[sort]);
  }, [
    books,
    progress,
    favIds,
    query,
    searchInside,
    ftsMatchingIds,
    filter,
    sort,
    formatType,
    selectedCollection,
    collectionBooks,
  ]);

  // Series Map for Series Grouping
  const seriesGroups = useMemo(() => {
    const map = new Map<string, Book[]>();
    for (const b of shown) {
      if (b.meta.series?.trim()) {
        const sName = b.meta.series.trim();
        const existing = map.get(sName) || [];
        existing.push(b);
        map.set(sName, existing);
      }
    }
    return map;
  }, [shown]);

  const openBook = useCallback(
    (b: Book) => {
      navigate(`/read/${b.id}`);
    },
    [navigate],
  );

  const removeBook = useCallback(async (b: Book) => {
    if (!(await confirmAction(`Remove “${b.title}” from your library?`))) return;
    const now = Date.now();
    await db.books.update(b.id, { deleted_at: now, ...dirty() });
    await db.files.delete(b.file_hash);
    await db.covers.delete(b.id);
    setDetailsBook(null);
  }, []);

  // Multi-selection operations
  const toggleSelectId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(shown.map((b) => b.id)));
  }, [shown]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const handleBulkAddToCollection = useCallback(
    async (colId: string) => {
      const selected = Array.from(selectedIds);
      if (selected.length === 0) return;
      // Bulk add in single transaction for sub-1s performance on 200+ books
      await db.transaction('rw', db.collection_books, async () => {
        for (const bookId of selected) {
          const rowId = `${colId}:${bookId}`;
          await db.collection_books.put({
            id: rowId,
            collection_id: colId,
            book_id: bookId,
            deleted_at: null,
            ...dirty(),
          });
        }
      });
      clearSelection();
    },
    [selectedIds, clearSelection],
  );

  const handleBulkToggleFavorite = useCallback(async () => {
    const selected = Array.from(selectedIds);
    if (selected.length === 0) return;
    const anyUnfav = selected.some((id) => !favIds.has(id));
    await db.transaction('rw', db.collection_books, async () => {
      for (const id of selected) {
        await setFavorite(id, anyUnfav);
      }
    });
    clearSelection();
  }, [selectedIds, favIds, clearSelection]);

  const handleBulkToggleFinished = useCallback(async () => {
    const selected = Array.from(selectedIds);
    if (selected.length === 0) return;
    const anyUnfinished = selected.some((id) => {
      const b = books.find((bk) => bk.id === id);
      return !b?.meta.finished_at && pct(b ?? ({} as Book)) < 0.99;
    });
    const nowMs = Date.now();
    await db.transaction('rw', db.books, db.progress, async () => {
      for (const id of selected) {
        const b = books.find((bk) => bk.id === id);
        if (b) {
          await db.books.update(id, {
            meta: {
              ...b.meta,
              finished_at: anyUnfinished ? nowMs : null,
            },
            ...dirty(),
          });
          if (anyUnfinished) {
            await db.progress.put({
              id,
              cfi: '',
              percent: 1,
              chapter: null,
              device_id: deviceId(),
              deleted_at: null,
              ...dirty(),
            });
          }
        }
      }
    });
    clearSelection();
  }, [selectedIds, books, pct, clearSelection]);

  const handleBulkExportZip = useCallback(async () => {
    const selectedBooks = books.filter((b) => selectedIds.has(b.id));
    if (selectedBooks.length === 0) return;
    setIsExportingZip(true);
    try {
      await exportBooks(selectedBooks);
      clearSelection();
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExportingZip(false);
    }
  }, [books, selectedIds, clearSelection]);

  const handleBulkDelete = useCallback(async () => {
    const selected = Array.from(selectedIds);
    if (selected.length === 0) return;
    const nowMs = Date.now();
    await db.transaction('rw', db.books, db.files, db.covers, async () => {
      for (const id of selected) {
        const b = books.find((bk) => bk.id === id);
        if (b) {
          await db.books.update(id, { deleted_at: nowMs, ...dirty() });
          await db.files.delete(b.file_hash);
          await db.covers.delete(id);
        }
      }
    });
    setBulkDeleteOpen(false);
    clearSelection();
  }, [selectedIds, books, clearSelection]);

  // Import pipeline handler with live progress dialog and duplicate resolution
  const handleProcessImportFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      const initialStatuses: FileImportStatus[] = fileList.map((f) => ({
        name: f.name,
        size: f.size,
        status: 'pending',
      }));
      setImportStatuses(initialStatuses);
      setImportProgressOpen(true);
      setImportComplete(false);

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;

      await importFiles(fileList, {
        signal: abortCtrl.signal,
        onProgress: (idx, _total, _file, status, error) => {
          setImportStatuses((prev) => {
            const next = [...prev];
            if (next[idx]) {
              next[idx] = {
                ...next[idx],
                status:
                  status === 'processing'
                    ? 'processing'
                    : status === 'done'
                      ? 'done'
                      : status === 'skipped'
                        ? 'skipped'
                        : 'error',
                error,
              };
            }
            return next;
          });
        },
        onDuplicate: (existingBook, newFile) => {
          return new Promise<'replace' | 'keep-both' | 'skip'>((resolve) => {
            setDuplicateResolution({
              existing: existingBook,
              newFile,
              resolve: (decision) => {
                setDuplicateResolution(null);
                resolve(decision);
              },
            });
          });
        },
      });

      setImportComplete(true);
    },
    [],
  );

  const createCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return;
    const newId = uid();
    await db.collections.add({
      id: newId,
      name: newCollectionName.trim(),
      sort_order: collections.length,
      deleted_at: null,
      ...dirty(),
    });
    setNewCollectionName('');
    setNewCollectionOpen(false);
    setSelectedCollection(newId);
  }, [collections.length, newCollectionName]);

  const renameCollection = useCallback(async () => {
    if (
      !renameCollectionName.trim() ||
      selectedCollection === 'all' ||
      selectedCollection === 'favorites'
    )
      return;
    await db.collections.update(selectedCollection, {
      name: renameCollectionName.trim(),
      ...dirty(),
    });
    setRenameCollectionOpen(false);
  }, [selectedCollection, renameCollectionName]);

  const deleteCollection = useCallback(async () => {
    if (selectedCollection === 'all' || selectedCollection === 'favorites') return;
    const nowMs = Date.now();
    await db.collections.update(selectedCollection, {
      deleted_at: nowMs,
      ...dirty(),
    });
    const related = collectionBooks.filter(
      (cb) => cb.collection_id === selectedCollection,
    );
    for (const r of related) {
      await db.collection_books.update(r.id, {
        deleted_at: nowMs,
        ...dirty(),
      });
    }
    setDeleteCollectionOpen(false);
    setSelectedCollection('all');
  }, [selectedCollection, collectionBooks]);

  const toggleBookInCollection = useCallback(
    async (bookId: string, colId: string) => {
      const existing = collectionBooks.find(
        (cb) => cb.collection_id === colId && cb.book_id === bookId,
      );
      if (existing) {
        await db.collection_books.update(existing.id, {
          deleted_at: Date.now(),
          ...dirty(),
        });
      } else {
        await db.collection_books.put({
          id: uid(),
          collection_id: colId,
          book_id: bookId,
          deleted_at: null,
          ...dirty(),
        });
      }
    },
    [collectionBooks],
  );

  // Dropdown sections
  const collectionDropdownSections = [
    {
      title: 'Views',
      items: [
        {
          key: 'all',
          label: 'All Books',
          checked: selectedCollection === 'all',
          onSelect: () => setSelectedCollection('all'),
        },
        {
          key: 'favorites',
          label: 'Favourites',
          checked: selectedCollection === 'favorites',
          onSelect: () => setSelectedCollection('favorites'),
        },
      ],
    },
    {
      title: 'Collections',
      items: [
        ...collections.map((c) => ({
          key: c.id,
          label: c.name,
          checked: selectedCollection === c.id,
          onSelect: () => setSelectedCollection(c.id),
        })),
        {
          key: 'new',
          label: '+ New collection',
          icon: <FolderPlus className="w-4 h-4" />,
          onSelect: () => setNewCollectionOpen(true),
        },
      ],
    },
  ];

  const sortDropdownSections = [
    {
      title: 'Sort by',
      items: [
        {
          key: 'recent',
          label: 'Recently read',
          checked: sort === 'recent',
          onSelect: () => {
            setSort('recent');
            localStorage.setItem('folio_lib_sort', 'recent');
          },
        },
        {
          key: 'added',
          label: 'Recently added',
          checked: sort === 'added',
          onSelect: () => {
            setSort('added');
            localStorage.setItem('folio_lib_sort', 'added');
          },
        },
        {
          key: 'series',
          label: 'Series',
          checked: sort === 'series',
          onSelect: () => {
            setSort('series');
            localStorage.setItem('folio_lib_sort', 'series');
          },
        },
        {
          key: 'title',
          label: 'Title',
          checked: sort === 'title',
          onSelect: () => {
            setSort('title');
            localStorage.setItem('folio_lib_sort', 'title');
          },
        },
        {
          key: 'author',
          label: 'Author',
          checked: sort === 'author',
          onSelect: () => {
            setSort('author');
            localStorage.setItem('folio_lib_sort', 'author');
          },
        },
        {
          key: 'progress',
          label: 'Reading progress',
          checked: sort === 'progress',
          onSelect: () => {
            setSort('progress');
            localStorage.setItem('folio_lib_sort', 'progress');
          },
        },
      ],
    },
  ];

  const filterDropdownSections = [
    {
      title: 'Reading Status',
      items: [
        {
          key: 'all',
          label: 'All books',
          checked: filter === 'all',
          onSelect: () => setFilter('all'),
        },
        {
          key: 'favorites',
          label: 'Favourites',
          checked: filter === 'favorites',
          onSelect: () => setFilter('favorites'),
        },
        {
          key: 'reading',
          label: 'Currently reading',
          checked: filter === 'reading',
          onSelect: () => setFilter('reading'),
        },
        {
          key: 'unread',
          label: 'Not started',
          checked: filter === 'unread',
          onSelect: () => setFilter('unread'),
        },
        {
          key: 'finished',
          label: 'Finished',
          checked: filter === 'finished',
          onSelect: () => setFilter('finished'),
        },
      ],
    },
  ];

  const addDropdownSections = [
    {
      items: [
        {
          key: 'add-files',
          label: 'Import file(s)…',
          icon: <Upload className="w-4 h-4" />,
          onSelect: () => fileInputRef.current?.click(),
        },
        {
          key: 'add-folder',
          label: 'Import folder…',
          icon: <Folder className="w-4 h-4" />,
          onSelect: () => folderInputRef.current?.click(),
        },
      ],
    },
  ];

  const getBookContextSections = useCallback(
    (b: Book) => {
      const fav = favIds.has(b.id);
      const isFinished = pct(b) >= 0.99 || !!b.meta.finished_at;
      const sections: DropdownMenuSection[] = [
        {
          items: [
            {
              key: 'open',
              label: 'Open reader',
              icon: <BookOpen className="w-4 h-4" />,
              onSelect: () => openBook(b),
            },
            {
              key: 'details',
              label: 'Book details',
              icon: <FileText className="w-4 h-4" />,
              onSelect: () => setDetailsBook(b),
            },
            {
              key: 'edit_meta',
              label: 'Edit metadata…',
              icon: <Edit3 className="w-4 h-4" />,
              onSelect: () => setEditingMetadataBook(b),
            },
            {
              key: 'fav',
              label: fav ? 'Remove favourite' : 'Add favourite',
              icon: <Heart className="w-4 h-4" />,
              onSelect: () => void toggleFavorite(b.id),
            },
            {
              key: 'finish',
              label: isFinished ? 'Mark unread' : 'Mark finished',
              icon: <CheckCircle className="w-4 h-4" />,
              onSelect: async () => {
                const nowMs = Date.now();
                await db.books.update(b.id, {
                  meta: {
                    ...b.meta,
                    finished_at: isFinished ? null : nowMs,
                  },
                  ...dirty(),
                });
                await db.progress.put({
                  id: b.id,
                  cfi: '',
                  percent: isFinished ? 0 : 1,
                  chapter: null,
                  device_id: deviceId(),
                  deleted_at: null,
                  ...dirty(),
                });
              },
            },
            {
              key: 'select',
              label: 'Select book',
              icon: <CheckSquare className="w-4 h-4" />,
              onSelect: () => {
                setSelectionMode(true);
                toggleSelectId(b.id);
              },
            },
            {
              key: 'remove',
              label: 'Remove book',
              icon: <Trash2 className="w-4 h-4" />,
              danger: true,
              onSelect: () => void removeBook(b),
            },
          ],
        },
      ];

      if (collections.length > 0) {
        sections.push({
          title: 'Collections',
          items: collections.map((c) => {
            const inCol = collectionBooks.some(
              (cb) => cb.collection_id === c.id && cb.book_id === b.id,
            );
            return {
              key: `col_${c.id}`,
              label: c.name,
              checked: inCol,
              onSelect: () => {
                void toggleBookInCollection(b.id, c.id);
              },
            };
          }),
        });
      }

      return sections;
    },
    [
      favIds,
      collections,
      collectionBooks,
      removeBook,
      toggleBookInCollection,
      openBook,
      pct,
      toggleSelectId,
    ],
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-base)]">
      {/* Hidden file & folder inputs for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void handleProcessImportFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard for folder picker
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void handleProcessImportFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />

      {/* 48px CommandBar */}
      <CommandBar
        title={
          <div className="flex items-center gap-1.5 min-w-0">
            <Dropdown
              trigger={
                <button
                  type="button"
                  className="flex items-center gap-1.5 min-w-0 max-w-full text-base font-semibold text-[var(--text-1)] hover:text-[var(--accent)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] px-1.5 py-1 rounded-[var(--r-sm)]"
                >
                  <span className="truncate">
                    {selectedCollection === 'all'
                      ? 'All Books'
                      : selectedCollection === 'favorites'
                        ? 'Favourites'
                        : collections.find((c) => c.id === selectedCollection)?.name ||
                          'Library'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-[var(--text-3)]" />
                </button>
              }
              sections={collectionDropdownSections}
            />

            {selectedCollection !== 'all' && selectedCollection !== 'favorites' && (
              <div className="flex items-center gap-0.5">
                <IconButton
                  size="sm"
                  label="Rename collection"
                  icon={<Edit3 className="w-3.5 h-3.5" />}
                  onClick={() => {
                    const col = collections.find((c) => c.id === selectedCollection);
                    if (col) {
                      setRenameCollectionName(col.name);
                      setRenameCollectionOpen(true);
                    }
                  }}
                />
                <IconButton
                  size="sm"
                  label="Delete collection"
                  icon={<Trash2 className="w-3.5 h-3.5 text-[var(--danger)]" />}
                  onClick={() => setDeleteCollectionOpen(true)}
                />
              </div>
            )}
          </div>
        }
        subtitle={`${shown.length} ${shown.length === 1 ? 'item' : 'items'}`}
        rightActions={
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div className="w-48 lg:w-64 hidden md:block">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Search title, author, tags…"
              />
            </div>

            {/* Full-text toggle */}
            <IconButton
              label={
                searchInside ? 'Full-text search active' : 'Search inside books (full-text)'
              }
              icon={<Sparkles className="w-4 h-4" />}
              variant={searchInside ? 'accent' : 'subtle'}
              onClick={() => setSearchInside(!searchInside)}
            />

            <Dropdown
              trigger={
                <IconButton
                  label="Filter books"
                  icon={<SlidersHorizontal className="w-4 h-4" />}
                />
              }
              sections={filterDropdownSections}
            />

            <Dropdown
              trigger={
                <IconButton
                  label="Sort books"
                  icon={<ArrowUpDown className="w-4 h-4" />}
                />
              }
              sections={sortDropdownSections}
            />

            {/* Layout toggle */}
            <IconButton
              label={layout === 'grid' ? 'Switch to list' : 'Switch to grid'}
              icon={
                layout === 'grid' ? (
                  <Rows3 className="w-4 h-4" />
                ) : (
                  <LayoutGrid className="w-4 h-4" />
                )
              }
              onClick={() => {
                const next = layout === 'grid' ? 'list' : 'grid';
                setLayout(next);
                localStorage.setItem('folio_lib_layout', next);
              }}
            />

            {/* Multi-select toggle button */}
            <Button
              variant={selectionMode ? 'accent' : 'subtle'}
              size="sm"
              onClick={() => {
                if (selectionMode) {
                  clearSelection();
                } else {
                  setSelectionMode(true);
                }
              }}
              aria-label={selectionMode ? 'Done selecting' : 'Select books'}
              className="gap-1.5 text-xs h-8 px-2"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{selectionMode ? 'Done' : 'Select'}</span>
            </Button>

            {/* Add Books Dropdown */}
            <Dropdown
              trigger={
                <Button
                  variant="accent"
                  size="sm"
                  icon={<Plus className="w-4 h-4" />}
                  disabled={shellImporting}
                >
                  {shellImporting ? 'Adding…' : 'Add'}
                </Button>
              }
              sections={addDropdownSections}
            />
          </div>
        }
      />

      {/* Sub-bar: Format Segmented Control */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 border-b border-[var(--stroke)] bg-[var(--layer-1)]">
        <SegmentedControl
          size="sm"
          options={[
            { value: 'all', label: 'All Items' },
            { value: 'books', label: 'Books' },
            { value: 'manga', label: 'Manga' },
            { value: 'comics', label: 'Comics' },
          ]}
          value={formatType}
          onChange={setFormatType}
        />

        {/* Mobile Search input */}
        <div className="md:hidden flex-1 min-w-[96px] max-w-[220px]">
          <SearchBox value={query} onChange={setQuery} placeholder="Search…" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {formatType === 'manga' ? (
          followedSeries && followedSeries.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="w-7 h-7" />}
              title="No manga in your library"
              description="Open a series in the Store and tap “Add to Library” (or the heart) to keep it here and get new-chapter updates."
              action={
                <Button variant="accent" onClick={() => navigate('/store')}>
                  Browse Store
                </Button>
              }
            />
          ) : (
            <CoverGrid columnWidth={150}>
              {[...(followedSeries ?? [])]
                // Favourites first, then most recently read.
                .sort(
                  (a, b) =>
                    Number(favIds.has(b.id)) - Number(favIds.has(a.id)) ||
                    (b.last_read_at ?? 0) - (a.last_read_at ?? 0),
                )
                .map((s) => (
                  <div key={s.id} className="cursor-pointer">
                    <BookCard
                      id={s.id}
                      title={s.title}
                      author={s.author || 'Unknown'}
                      coverUrl={s.cover_url}
                      isFavourite={favIds.has(s.id)}
                      onToggleFavourite={() => void toggleFavorite(s.id, favIds.has(s.id))}
                      onClick={() => navigate(`/series/${encodeURIComponent(s.id)}`)}
                    />
                  </div>
                ))}
            </CoverGrid>
          )
        ) : books.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="w-7 h-7" />}
            title="Your library is empty"
            description="Drag and drop your EPUB, MOBI, AZW3, FB2, CBZ, or PDF files here to begin reading."
            action={
              <Button
                variant="accent"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => fileInputRef.current?.click()}
              >
                Add Books
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No matching books"
            description={
              query
                ? `No books match the search query "${query}".`
                : 'No books match the current filter selection.'
            }
            action={
              <Button
                variant="standard"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                  setFormatType('all');
                }}
              >
                Clear Filters
              </Button>
            }
          />
        ) : sort === 'series' && seriesGroups.size > 0 ? (
          /* Series Grouped View */
          <div className="space-y-6">
            {Array.from(seriesGroups.entries()).map(([seriesName, seriesBooks]) => {
              const completedCount = seriesBooks.filter(
                (b) => pct(b) >= 0.99 || b.meta.finished_at,
              ).length;
              return (
                <div
                  key={seriesName}
                  className="p-4 rounded-xl bg-[var(--layer-2)] border border-[var(--stroke)] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3
                        onClick={() =>
                          setViewingSeries({ name: seriesName, books: seriesBooks })
                        }
                        className="text-base font-bold text-[var(--text-1)] hover:text-[var(--accent)] transition-colors cursor-pointer inline-flex items-center gap-2"
                      >
                        <BookMarked className="w-4 h-4 text-[var(--accent)]" />
                        <span>{seriesName}</span>
                      </h3>
                      <p className="text-xs text-[var(--text-3)] mt-0.5">
                        {seriesBooks.length} volumes • {completedCount} read
                      </p>
                    </div>

                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() =>
                        setViewingSeries({ name: seriesName, books: seriesBooks })
                      }
                      className="text-xs"
                    >
                      View series
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                    {seriesBooks.map((b) => (
                      <ContextMenu key={b.id} sections={getBookContextSections(b)}>
                        <div>
                          <BookCard
                            id={b.id}
                            title={b.title}
                            author={b.author}
                            coverHash={b.cover_hash}
                            progressPercent={Math.round(pct(b) * 100)}
                            isFavourite={favIds.has(b.id)}
                            onToggleFavourite={() => void toggleFavorite(b.id)}
                            onClick={() => openBook(b)}
                            isSelectable={selectionMode}
                            isSelected={selectedIds.has(b.id)}
                            onToggleSelect={() => toggleSelectId(b.id)}
                            badge={
                              pct(b) >= 0.99 || b.meta.finished_at ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--layer-solid)] text-[var(--success)] border border-[var(--success)]/40 shadow-xs flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                </span>
                              ) : undefined
                            }
                          />
                        </div>
                      </ContextMenu>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : layout === 'grid' ? (
          <CoverGrid columnWidth={150}>
            {shown.map((b) => {
              const fav = favIds.has(b.id);
              const isFinished = pct(b) >= 0.99 || !!b.meta.finished_at;
              return (
                <ContextMenu key={b.id} sections={getBookContextSections(b)}>
                  <div>
                    <BookCard
                      id={b.id}
                      title={b.title}
                      author={b.author}
                      coverHash={b.cover_hash}
                      progressPercent={Math.round(pct(b) * 100)}
                      isFavourite={fav}
                      onToggleFavourite={() => void toggleFavorite(b.id)}
                      onClick={() => openBook(b)}
                      isSelectable={selectionMode}
                      isSelected={selectedIds.has(b.id)}
                      onToggleSelect={() => toggleSelectId(b.id)}
                      badge={
                        isFinished ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--layer-solid)] text-[var(--success)] border border-[var(--success)]/40 shadow-xs flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                          </span>
                        ) : undefined
                      }
                    />
                  </div>
                </ContextMenu>
              );
            })}
          </CoverGrid>
        ) : (
          /* List Layout */
          <div className="flex flex-col gap-1 py-2">
            {shown.map((b) => {
              const fav = favIds.has(b.id);
              const isFinished = pct(b) >= 0.99 || !!b.meta.finished_at;
              return (
                <ContextMenu key={b.id} sections={getBookContextSections(b)}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (selectionMode) toggleSelectId(b.id);
                      else openBook(b);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (selectionMode) toggleSelectId(b.id);
                        else openBook(b);
                      }
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-[var(--r-md)] transition-colors cursor-pointer select-none border ${
                      selectedIds.has(b.id)
                        ? 'bg-[var(--accent)]/10 border-[var(--accent)]'
                        : 'hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] border-transparent hover:border-[var(--stroke)]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {selectionMode && (
                        <div
                          className="shrink-0 p-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectId(b.id);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(b.id)}
                            onChange={() => toggleSelectId(b.id)}
                            className="w-4 h-4 rounded text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                          />
                        </div>
                      )}

                      <div className="w-10 shrink-0">
                        <BookCard
                          id={b.id}
                          title={b.title}
                          author={b.author}
                          coverHash={b.cover_hash}
                          showMetadata={false}
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-[var(--text-1)] truncate flex items-center gap-1.5">
                          {fav && (
                            <Heart className="w-3.5 h-3.5 fill-[var(--accent)] text-[var(--accent)] shrink-0" />
                          )}
                          <span className="truncate">{b.title}</span>
                          {b.meta.series && (
                            <span className="text-[11px] font-normal text-[var(--text-3)] truncate hidden md:inline">
                              ({b.meta.series}
                              {b.meta.series_number ? ` #${b.meta.series_number}` : ''})
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-[var(--text-3)] truncate mt-0.5">
                          {b.author}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 text-xs text-[var(--text-3)]">
                      <span className="hidden md:inline font-mono">{b.format}</span>
                      <span className="hidden sm:inline">{fmtBytes(b.file_size)}</span>
                      <span className="w-20 text-right font-medium text-[var(--text-2)]">
                        {isFinished ? (
                          <span className="text-[var(--success)] inline-flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Finished
                          </span>
                        ) : pct(b) > 0 ? (
                          `${Math.round(pct(b) * 100)}%`
                        ) : (
                          'New'
                        )}
                      </span>
                      <IconButton
                        label="Details"
                        icon={<MoreVertical className="w-4 h-4" />}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailsBook(b);
                        }}
                      />
                    </div>
                  </div>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk Action Bar (Docked when >= 1 book selected) */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        totalCount={shown.length}
        isAllSelected={selectedIds.size === shown.length && shown.length > 0}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onAddToCollection={() => setBulkCollectionOpen(true)}
        onToggleFavorite={() => void handleBulkToggleFavorite()}
        onToggleFinished={() => void handleBulkToggleFinished()}
        onExport={() => void handleBulkExportZip()}
        onDelete={() => setBulkDeleteOpen(true)}
        exporting={isExportingZip}
      />

      {/* Bulk Add to Collection Dialog */}
      <BulkCollectionDialog
        open={bulkCollectionOpen}
        collections={collections}
        selectedCount={selectedIds.size}
        onClose={() => setBulkCollectionOpen(false)}
        onAssign={(colId) => void handleBulkAddToCollection(colId)}
        onCreateNewCollection={async (name) => {
          const newId = uid();
          await db.collections.add({
            id: newId,
            name,
            sort_order: collections.length,
            deleted_at: null,
            ...dirty(),
          });
          void handleBulkAddToCollection(newId);
        }}
      />

      {/* Bulk Remove Confirm Dialog */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Remove Selected Books"
        description={`Remove ${selectedIds.size} selected books from your library? Book files and reading progress will be permanently deleted.`}
        footer={
          <>
            <Button variant="subtle" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              className="bg-[var(--danger)] hover:opacity-90"
              onClick={() => void handleBulkDelete()}
            >
              Remove {selectedIds.size} books
            </Button>
          </>
        }
      >
        <div className="py-2 text-xs text-[var(--text-2)]">
          This operation will sync across all registered devices.
        </div>
      </Dialog>

      {/* Edit Metadata Modal */}
      <EditMetadataDialog
        open={!!editingMetadataBook}
        book={editingMetadataBook}
        onClose={() => setEditingMetadataBook(null)}
        onSaved={(updated) => {
          setEditingMetadataBook(null);
          if (detailsBook?.id === updated.id) {
            setDetailsBook(updated);
          }
        }}
      />

      {/* Series Detail View Modal */}
      {viewingSeries && (
        <SeriesDetailView
          open={!!viewingSeries}
          seriesName={viewingSeries.name}
          books={viewingSeries.books}
          progressMap={progress}
          onOpenBook={openBook}
          favIds={favIds}
          onToggleFavorite={(id) => void toggleFavorite(id)}
          onClose={() => setViewingSeries(null)}
        />
      )}

      {/* Import Progress Dialog */}
      <ImportProgressDialog
        open={importProgressOpen}
        files={importStatuses}
        isComplete={importComplete}
        onCancel={() => {
          abortControllerRef.current?.abort();
          setImportProgressOpen(false);
        }}
        onClose={() => setImportProgressOpen(false)}
      />

      {/* Duplicate Book Resolution Dialog */}
      {duplicateResolution && (
        <DuplicateDialog
          open={!!duplicateResolution}
          existingBook={duplicateResolution.existing}
          newFile={duplicateResolution.newFile}
          onDecision={(d) => duplicateResolution.resolve(d)}
        />
      )}

      {/* Two-Column Details Sheet */}
      {detailsBook && (
        <DetailsDialog
          book={detailsBook}
          progress={progress.get(detailsBook.id)}
          favorite={favIds.has(detailsBook.id)}
          onClose={() => setDetailsBook(null)}
          onRead={() => openBook(detailsBook)}
          onEdit={() => {
            setEditingMetadataBook(detailsBook);
            setDetailsBook(null);
          }}
          onToggleFavorite={() => void toggleFavorite(detailsBook.id)}
          onRemove={() => void removeBook(detailsBook)}
        />
      )}

      {/* New Collection Modal */}
      <Dialog
        open={newCollectionOpen}
        onOpenChange={setNewCollectionOpen}
        title="New Collection"
        description="Create a collection to organize your library."
        footer={
          <>
            <Button variant="subtle" onClick={() => setNewCollectionOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={() => void createCollection()}>
              Create
            </Button>
          </>
        }
      >
        <div className="py-2">
          <input
            type="text"
            placeholder="Collection name…"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createCollection()}
            className="w-full h-9 px-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </Dialog>

      {/* Rename Collection Modal */}
      <Dialog
        open={renameCollectionOpen}
        onOpenChange={setRenameCollectionOpen}
        title="Rename Collection"
        description="Update the name of this collection."
        footer={
          <>
            <Button variant="subtle" onClick={() => setRenameCollectionOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={() => void renameCollection()}>
              Save
            </Button>
          </>
        }
      >
        <div className="py-2">
          <input
            type="text"
            placeholder="Collection name…"
            value={renameCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void renameCollection()}
            className="w-full h-9 px-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </Dialog>

      {/* Delete Collection Modal */}
      <Dialog
        open={deleteCollectionOpen}
        onOpenChange={setDeleteCollectionOpen}
        title="Delete Collection"
        description="Are you sure you want to delete this collection? The books inside will remain in your library."
        footer={
          <>
            <Button variant="subtle" onClick={() => setDeleteCollectionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              className="bg-[var(--danger)] hover:opacity-90"
              onClick={() => void deleteCollection()}
            >
              Delete Collection
            </Button>
          </>
        }
      >
        <div className="py-2 text-xs text-[var(--text-2)]">
          This collection will be deleted across all your synced devices.
        </div>
      </Dialog>
    </div>
  );
}

function DetailsDialog({
  book,
  progress,
  favorite,
  onClose,
  onRead,
  onEdit,
  onToggleFavorite,
  onRemove,
}: {
  book: Book;
  progress?: Progress;
  favorite: boolean;
  onClose: () => void;
  onRead: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onRemove: () => void;
}) {
  const m = book.meta;
  const countable = book.format !== 'PDF' && book.format !== 'CBZ';
  const isFinished = (progress?.percent ?? 0) >= 0.99 || !!m.finished_at;

  // Reading insights
  const sessions = useLiveQuery(
    () => db.reading_sessions.where('book_id').equals(book.id).filter((s) => !s.deleted_at).toArray(),
    [book.id],
    [],
  );
  const annotations = useLiveQuery(
    () => db.annotations.where('book_id').equals(book.id).filter((a) => !a.deleted_at).toArray(),
    [book.id],
    [],
  );

  const totalTimeSpentSec = useMemo(
    () => sessions.reduce((acc, s) => acc + s.duration_sec, 0),
    [sessions],
  );
  const sessionCount = sessions.length;
  const firstSessionAt = useMemo(
    () => (sessions.length > 0 ? Math.min(...sessions.map((s) => s.started_at)) : null),
    [sessions],
  );

  const totalWords = useMemo(
    () => sessions.reduce((acc, s) => acc + (s.words_read || 0), 0),
    [sessions],
  );
  const userWpm = totalTimeSpentSec > 60 && totalWords > 0 ? Math.round((totalWords / totalTimeSpentSec) * 60) : 250;
  const remainingFraction = Math.max(0, 1 - (progress?.percent ?? 0));
  const estimatedTimeLeftMin = m.word_count ? Math.round((remainingFraction * m.word_count) / userWpm) : null;

  const facts: [string, string][] = [
    ['Format', book.format],
    ['File size', fmtBytes(book.file_size)],
    [
      'Words',
      !countable
        ? '—'
        : m.word_count != null
          ? m.word_count.toLocaleString()
          : 'Counting…',
    ],
    [
      'Paragraphs',
      !countable
        ? '—'
        : m.paragraph_count != null
          ? m.paragraph_count.toLocaleString()
          : 'Counting…',
    ],
    ['Time spent', totalTimeSpentSec > 0 ? formatDuration(totalTimeSpentSec) : '0m'],
    ['Sessions', `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`],
    [
      'Estimated time left',
      isFinished
        ? 'Finished'
        : estimatedTimeLeftMin != null
          ? fmtMinutes(estimatedTimeLeftMin)
          : '—',
    ],
    [
      'Progress',
      isFinished
        ? 'Finished'
        : progress
          ? `${Math.round(progress.percent * 100)}%`
          : 'Not started',
    ],
    [
      'Started',
      firstSessionAt
        ? fmtDate(firstSessionAt)
        : book.last_opened_at
          ? fmtDate(book.last_opened_at)
          : 'Not started',
    ],
    [
      'Finished',
      m.finished_at ? fmtDate(m.finished_at) : isFinished ? 'Finished' : 'In progress',
    ],
    [
      'Highlights',
      `${annotations.length} ${annotations.length === 1 ? 'highlight' : 'highlights'}`,
    ],
    ['Rating', m.rating ? `${m.rating} / 5 stars` : '—'],
    ['Language', m.language || '—'],
    ['Publisher', m.publisher || '—'],
    [
      'Series',
      m.series
        ? `${m.series}${m.series_number ? ` (Vol. ${m.series_number})` : ''}`
        : '—',
    ],
    ['Tags', m.tags?.length ? m.tags.map((t) => `#${t}`).join(', ') : '—'],
    ['Added', fmtDate(book.added_at)],
    ['Last opened', book.last_opened_at ? fmtDate(book.last_opened_at) : 'Never'],
  ];

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => !open && onClose()}
      title="Book Details"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="danger"
            icon={<Trash2 className="w-4 h-4" />}
            onClick={onRemove}
          >
            Remove
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="standard"
              icon={<Edit3 className="w-4 h-4" />}
              onClick={onEdit}
            >
              Edit metadata
            </Button>
            <Button
              variant="standard"
              icon={
                <Heart
                  className={`w-4 h-4 ${
                    favorite ? 'fill-current text-[var(--accent)]' : ''
                  }`}
                />
              }
              onClick={onToggleFavorite}
            >
              {favorite ? 'Favorited' : 'Favorite'}
            </Button>
            <Button
              variant="accent"
              icon={<BookOpen className="w-4 h-4" />}
              onClick={onRead}
            >
              Read Now
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col sm:flex-row gap-6 py-2">
        {/* Left: Book Cover preview */}
        <div className="w-36 shrink-0 mx-auto sm:mx-0">
          <BookCard
            id={book.id}
            title={book.title}
            author={book.author}
            coverHash={book.cover_hash}
            showMetadata={false}
          />
        </div>

        {/* Right: Metadata Grid */}
        <div className="grow space-y-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-1)] leading-snug">
              {book.title}
            </h3>
            <p className="text-sm text-[var(--text-2)] font-medium mt-0.5">
              {book.author}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-2 border-t border-[var(--stroke)]">
            {facts.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-[var(--text-3)]">{k}</dt>
                <dd className="font-medium text-[var(--text-1)] text-right truncate">
                  {v}
                </dd>
              </Fragment>
            ))}
          </dl>

          {m.description && (
            <div className="pt-2 border-t border-[var(--stroke)]">
              <p className="text-xs text-[var(--text-2)] line-clamp-4 leading-relaxed">
                {m.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}