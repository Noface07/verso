import { useMemo, useState, useCallback, Fragment } from 'react';
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
} from 'lucide-react';
import { db, dirty, uid, type Book, type Progress, type Collection } from '../db';
import { fmtBytes, fmtDate, fmtMinutes } from '../lib/format';
import { toggleFavorite, useFavoriteIds } from '../lib/favourites';
import { CommandBar } from '../design/components/CommandBar';
import { SegmentedControl } from '../design/components/SegmentedControl';
import { SearchBox } from '../design/components/SearchBox';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { Dropdown } from '../design/components/Dropdown';
import { ContextMenu } from '../design/components/ContextMenu';
import { Dialog } from '../design/components/Dialog';
import { CoverGrid } from '../design/components/CoverGrid';
import { BookCard } from '../design/components/BookCard';
import { EmptyState } from '../design/components/EmptyState';
import type { ShellContext } from '../components/Shell';

type SortKey = 'recent' | 'added' | 'title' | 'author' | 'progress';
type FilterKey = 'all' | 'favorites' | 'reading' | 'unread' | 'finished';
type FormatType = 'all' | 'books' | 'comics';

export default function Library() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { openImport, importing } = useOutletContext<ShellContext>();

  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[]);
  const progressRows = useLiveQuery(() => db.progress.toArray(), [], [] as Progress[]);
  const collections = useLiveQuery(() => db.collections.filter((c) => !c.deleted_at).toArray(), [], [] as Collection[]);
  const favIds = useFavoriteIds();

  const [query, setQuery] = useState('');
  const [formatType, setFormatType] = useState<FormatType>('all');
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
    return (localStorage.getItem('folio_lib_layout') as 'grid' | 'list' | 'compact') || 'grid';
  });
  const [detailsBook, setDetailsBook] = useState<Book | null>(null);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const progress = useMemo(() => new Map(progressRows.map((p) => [p.id, p])), [progressRows]);
  const pct = (b: Book) => progress.get(b.id)?.percent ?? 0;

  // Filter & Sort
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = books.filter((b) => {
      // Format segmented filter
      if (formatType === 'comics' && b.format !== 'CBZ' && b.format !== 'CBR') return false;
      if (formatType === 'books' && (b.format === 'CBZ' || b.format === 'CBR')) return false;

      // Search query
      if (q && !`${b.title} ${b.author} ${b.meta.series ?? ''}`.toLowerCase().includes(q)) return false;

      // Reading status filter
      const p = progress.get(b.id)?.percent ?? 0;
      if (filter === 'favorites') return favIds.has(b.id);
      if (filter === 'reading') return p > 0 && p < 0.99;
      if (filter === 'unread') return p === 0;
      if (filter === 'finished') return p >= 0.99;
      return true;
    });

    const cmp: Record<SortKey, (a: Book, b: Book) => number> = {
      recent: (a, b) => (b.last_opened_at ?? b.added_at) - (a.last_opened_at ?? a.added_at),
      added: (a, b) => b.added_at - a.added_at,
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
      progress: (a, b) => (progress.get(b.id)?.percent ?? 0) - (progress.get(a.id)?.percent ?? 0),
    };

    return list.sort(cmp[sort]);
  }, [books, progress, favIds, query, filter, sort, formatType]);

  const openBook = (b: Book) => navigate(`/read/${b.id}`);

  const removeBook = useCallback(async (b: Book) => {
    if (!confirm(`Remove “${b.title}” from your library?`)) return;
    const now = Date.now();
    await db.books.update(b.id, { deleted_at: now, ...dirty() });
    await db.files.delete(b.file_hash);
    await db.covers.delete(b.id);
    setDetailsBook(null);
  }, []);

  const createCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return;
    await db.collections.add({
      id: uid(),
      name: newCollectionName.trim(),
      sort_order: collections.length,
      deleted_at: null,
      ...dirty(),
    });
    setNewCollectionName('');
    setNewCollectionOpen(false);
  }, [collections.length, newCollectionName]);

  // Collection Dropdown Items
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

  // Sort Dropdown Items
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

  // Filter Dropdown Items
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-base)]">
      {/* 48px CommandBar */}
      <CommandBar
        title={
          <Dropdown
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 text-base font-semibold text-[var(--text-1)] hover:text-[var(--accent)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] px-1.5 py-1 rounded-[var(--r-sm)]"
              >
                <span>
                  {selectedCollection === 'all'
                    ? 'All Books'
                    : selectedCollection === 'favorites'
                      ? 'Favourites'
                      : collections.find((c) => c.id === selectedCollection)?.name || 'Library'}
                </span>
                <ChevronDown className="w-4 h-4 text-[var(--text-3)]" />
              </button>
            }
            sections={collectionDropdownSections}
          />
        }
        subtitle={`${shown.length} ${shown.length === 1 ? 'item' : 'items'}`}
        rightActions={
          <div className="flex items-center gap-1.5">
            <div className="w-48 sm:w-64 hidden sm:block">
              <SearchBox value={query} onChange={setQuery} placeholder="Search title or author…" />
            </div>

            <Dropdown
              trigger={
                <IconButton label="Filter books" icon={<SlidersHorizontal className="w-4 h-4" />} />
              }
              sections={filterDropdownSections}
            />

            <Dropdown
              trigger={
                <IconButton label="Sort books" icon={<ArrowUpDown className="w-4 h-4" />} />
              }
              sections={sortDropdownSections}
            />

            {/* Layout toggle */}
            <IconButton
              label={layout === 'grid' ? 'Switch to list' : 'Switch to grid'}
              icon={layout === 'grid' ? <Rows3 className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
              onClick={() => {
                const next = layout === 'grid' ? 'list' : 'grid';
                setLayout(next);
                localStorage.setItem('folio_lib_layout', next);
              }}
            />

            <Button
              variant="accent"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={openImport}
              disabled={importing}
            >
              {importing ? 'Adding…' : 'Add'}
            </Button>
          </div>
        }
      />

      {/* Sub-bar: Format Segmented Control */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-[var(--stroke)] bg-[var(--layer-1)]">
        <SegmentedControl
          size="sm"
          options={[
            { value: 'all', label: 'All Items' },
            { value: 'books', label: 'Books' },
            { value: 'comics', label: 'Comics' },
          ]}
          value={formatType}
          onChange={setFormatType}
        />

        {/* Mobile Search input */}
        <div className="sm:hidden w-40">
          <SearchBox value={query} onChange={setQuery} placeholder="Search…" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {books.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="w-7 h-7" />}
            title="Your library is empty"
            description="Drag and drop your EPUB, MOBI, AZW3, FB2, CBZ, or PDF files here to begin reading."
            action={
              <Button variant="accent" icon={<Plus className="w-4 h-4" />} onClick={openImport}>
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
        ) : layout === 'grid' ? (
          <CoverGrid columnWidth={150}>
            {shown.map((b) => {
              const fav = favIds.has(b.id);
              const contextSections = [
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
                      key: 'fav',
                      label: fav ? 'Remove favourite' : 'Add favourite',
                      icon: <Heart className="w-4 h-4" />,
                      onSelect: () => void toggleFavorite(b.id),
                    },
                    {
                      key: 'finish',
                      label: pct(b) >= 0.99 ? 'Mark unread' : 'Mark finished',
                      icon: <CheckCircle className="w-4 h-4" />,
                      onSelect: async () => {
                        const newPercent = pct(b) >= 0.99 ? 0 : 1;
                        await db.progress.put({
                          id: b.id,
                          cfi: '',
                          percent: newPercent,
                          chapter: null,
                          device_id: 'local',
                          deleted_at: null,
                          ...dirty(),
                        });
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

              return (
                <ContextMenu key={b.id} sections={contextSections}>
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
              return (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openBook(b)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openBook(b)}
                  className="flex items-center justify-between p-2.5 rounded-[var(--r-md)] hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] transition-colors cursor-pointer select-none border border-transparent hover:border-[var(--stroke)]"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
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
                        {fav && <Heart className="w-3.5 h-3.5 fill-[var(--accent)] text-[var(--accent)] shrink-0" />}
                        <span className="truncate">{b.title}</span>
                      </h4>
                      <p className="text-xs text-[var(--text-3)] truncate mt-0.5">{b.author}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs text-[var(--text-3)]">
                    <span className="hidden md:inline font-mono">{b.format}</span>
                    <span className="hidden sm:inline">{fmtBytes(b.file_size)}</span>
                    <span className="w-16 text-right font-medium text-[var(--text-2)]">
                      {pct(b) > 0 ? `${Math.round(pct(b) * 100)}%` : 'New'}
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
              );
            })}
          </div>
        )}
      </div>

      {/* Two-Column Details Sheet */}
      {detailsBook && (
        <DetailsDialog
          book={detailsBook}
          progress={progress.get(detailsBook.id)}
          favorite={favIds.has(detailsBook.id)}
          onClose={() => setDetailsBook(null)}
          onRead={() => openBook(detailsBook)}
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
    </div>
  );
}

function DetailsDialog({
  book,
  progress,
  favorite,
  onClose,
  onRead,
  onToggleFavorite,
  onRemove,
}: {
  book: Book;
  progress?: Progress;
  favorite: boolean;
  onClose: () => void;
  onRead: () => void;
  onToggleFavorite: () => void;
  onRemove: () => void;
}) {
  const m = book.meta;
  const countable = book.format !== 'PDF' && book.format !== 'CBZ';
  const facts: [string, string][] = [
    ['Format', book.format],
    ['File size', fmtBytes(book.file_size)],
    ['Words', !countable ? '—' : m.word_count != null ? m.word_count.toLocaleString() : 'Counting…'],
    ['Paragraphs', !countable ? '—' : m.paragraph_count != null ? m.paragraph_count.toLocaleString() : 'Counting…'],
    ['Reading time', m.word_count ? `about ${fmtMinutes(m.word_count / 250)}` : '—'],
    ['Progress', progress ? `${Math.round(progress.percent * 100)}%` : 'Not started'],
    ['Language', m.language || '—'],
    ['Publisher', m.publisher || '—'],
    ['Series', m.series || '—'],
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
          <Button variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={onRemove}>
            Remove
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="standard"
              icon={<Heart className={`w-4 h-4 ${favorite ? 'fill-current text-[var(--accent)]' : ''}`} />}
              onClick={onToggleFavorite}
            >
              {favorite ? 'Favorited' : 'Favorite'}
            </Button>
            <Button variant="accent" icon={<BookOpen className="w-4 h-4" />} onClick={onRead}>
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
            <h3 className="text-lg font-bold text-[var(--text-1)] leading-snug">{book.title}</h3>
            <p className="text-sm text-[var(--text-2)] font-medium mt-0.5">{book.author}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-2 border-t border-[var(--stroke)]">
            {facts.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-[var(--text-3)]">{k}</dt>
                <dd className="font-medium text-[var(--text-1)] text-right truncate">{v}</dd>
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