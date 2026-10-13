import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  NotebookPen,
  StickyNote,
  Download,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { db, type Annotation, type Book } from '../db';
import { compareCFI } from '../lib/foliate';
import { HIGHLIGHT_COLORS, colorHex } from '../lib/readerSettings';
import { fmtDate } from '../lib/format';
import { CommandBar } from '../design/components/CommandBar';
import { SearchBox } from '../design/components/SearchBox';
import { Button } from '../design/components/Button';
import { Dropdown } from '../design/components/Dropdown';
import { BookCard } from '../design/components/BookCard';
import { EmptyState } from '../design/components/EmptyState';

function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="bg-[var(--accent-soft)] text-[var(--accent)] rounded-xs px-0.5">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export default function Notebook() {
  const navigate = useNavigate();

  const annotations = useLiveQuery(
    () => db.annotations.filter((a) => !a.deleted_at && a.type !== 'bookmark').toArray(),
    [],
    [] as Annotation[],
  );
  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[]);

  const [query, setQuery] = useState('');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [notesOnly, setNotesOnly] = useState(false);
  const [collapsedBooks, setCollapsedBooks] = useState<Record<string, boolean>>({});

  const toggleCollapse = (bookId: string) => {
    setCollapsedBooks((prev) => ({ ...prev, [bookId]: !prev[bookId] }));
  };

  const groups = useMemo(() => {
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const needle = query.trim().toLowerCase();
    const byBook = new Map<string, Annotation[]>();

    for (const a of annotations) {
      if (!bookMap.has(a.book_id)) continue;
      if (colorFilter && a.color !== colorFilter) continue;
      if (notesOnly && !a.note) continue;
      if (needle && !`${a.text} ${a.note} ${a.chapter}`.toLowerCase().includes(needle)) continue;
      byBook.set(a.book_id, [...(byBook.get(a.book_id) ?? []), a]);
    }

    return [...byBook.entries()]
      .map(([id, list]) => ({
        book: bookMap.get(id)!,
        items: list.sort((x, y) => compareCFI(x.cfi, y.cfi) || x.created_at - y.created_at),
        latest: Math.max(...list.map((a) => a.updated_at)),
      }))
      .sort((a, b) => b.latest - a.latest);
  }, [annotations, books, query, colorFilter, notesOnly]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  // Export functions
  const exportMarkdown = () => {
    let md = '# Folio Notebook Export\n\n';
    for (const g of groups) {
      md += `## ${g.book.title} — ${g.book.author}\n\n`;
      for (const item of g.items) {
        md += `> ${item.text}\n\n`;
        if (item.note) md += `**Note**: ${item.note}\n\n`;
        md += `*${item.chapter || 'Chapter'} · ${fmtDate(item.created_at)}*\n\n---\n\n`;
      }
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-annotations-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const data = groups.map((g) => ({
      book: { id: g.book.id, title: g.book.title, author: g.book.author },
      annotations: g.items,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-annotations-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDropdownSections = [
    {
      title: 'Export Annotations',
      items: [
        {
          key: 'markdown',
          label: 'Export as Markdown (.md)',
          onSelect: exportMarkdown,
        },
        {
          key: 'json',
          label: 'Export as JSON (.json)',
          onSelect: exportJSON,
        },
      ],
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-base)] text-[var(--text-1)]">
      {/* 48px CommandBar */}
      <CommandBar
        title="Notebook"
        subtitle={`${total} ${total === 1 ? 'highlight' : 'highlights'}`}
        rightActions={
          <div className="flex items-center gap-2">
            <div className="w-52 sm:w-64">
              <SearchBox value={query} onChange={setQuery} placeholder="Search highlights & notes…" />
            </div>

            <Dropdown
              trigger={
                <Button variant="standard" size="sm" icon={<Download className="w-4 h-4" />}>
                  Export
                </Button>
              }
              sections={exportDropdownSections}
            />
          </div>
        }
      />

      {/* Filter Toolbar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-[var(--stroke)] bg-[var(--layer-1)]">
        <div className="flex items-center gap-4">
          {/* Color Dots */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setColorFilter(null)}
              className={`text-xs px-2 py-0.5 rounded-[var(--r-sm)] border cursor-pointer ${
                colorFilter === null
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                  : 'border-[var(--stroke)] text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              All
            </button>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.label}
                onClick={() => setColorFilter(colorFilter === c.id ? null : c.id)}
                className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center ${
                  colorFilter === c.id ? 'ring-2 ring-[var(--text-1)] ring-offset-2 ring-offset-[var(--layer-solid)]' : ''
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>

          {/* Notes Only Toggle */}
          <button
            type="button"
            onClick={() => setNotesOnly(!notesOnly)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-[var(--r-md)] border cursor-pointer transition-colors ${
              notesOnly
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                : 'border-[var(--stroke)] text-[var(--text-2)] hover:bg-[var(--layer-2)]'
            }`}
          >
            <StickyNote className="w-3.5 h-3.5" />
            <span>Notes only</span>
          </button>
        </div>
      </div>

      {/* Main Highlights List */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-5xl mx-auto w-full">
        {annotations.length === 0 ? (
          <EmptyState
            icon={<NotebookPen className="w-7 h-7" />}
            title="No highlights yet"
            description="Select text in any book while reading to highlight passages, choose colors, or attach personal notes."
          />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No matching annotations"
            description="Try choosing a different color filter or clearing your search term."
            action={
              <Button
                variant="standard"
                onClick={() => {
                  setQuery('');
                  setColorFilter(null);
                  setNotesOnly(false);
                }}
              >
                Clear Filters
              </Button>
            }
          />
        ) : (
          groups.map(({ book, items }) => {
            const isCollapsed = !!collapsedBooks[book.id];
            return (
              <div
                key={book.id}
                className="rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] overflow-hidden shadow-xs"
              >
                {/* Book Header Accordion Toggle */}
                <button
                  type="button"
                  onClick={() => toggleCollapse(book.id)}
                  className="w-full flex items-center justify-between p-4 bg-[var(--layer-1)] hover:bg-[var(--layer-3)] transition-colors cursor-pointer text-left outline-none"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 shrink-0">
                      <BookCard
                        id={book.id}
                        title={book.title}
                        author={book.author}
                        coverHash={book.cover_hash}
                        showMetadata={false}
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-[var(--text-1)] truncate">
                        {book.title}
                      </h3>
                      <p className="text-xs text-[var(--text-3)] truncate mt-0.5">
                        {book.author} · {items.length} {items.length === 1 ? 'item' : 'items'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[var(--text-3)]">
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {/* Items in Book Group */}
                {!isCollapsed && (
                  <div className="divide-y divide-[var(--stroke)] p-2 space-y-2">
                    {items.map((a) => {
                      const hex = colorHex(a.color);
                      return (
                        <div
                          key={a.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            navigate(`/read/${a.book_id}?cfi=${encodeURIComponent(a.cfi)}`)
                          }
                          onKeyDown={(e) =>
                            (e.key === 'Enter' || e.key === ' ') &&
                            navigate(`/read/${a.book_id}?cfi=${encodeURIComponent(a.cfi)}`)
                          }
                          className="group relative flex flex-col gap-2 p-3.5 rounded-[var(--r-md)] hover:bg-[var(--layer-3)] transition-colors cursor-pointer select-none text-left"
                        >
                          {/* Color bar indicator on left */}
                          <div
                            className="absolute left-1 top-3.5 bottom-3.5 w-1 rounded-full"
                            style={{ backgroundColor: hex }}
                          />

                          <div className="pl-3.5 space-y-2">
                            <blockquote className="text-sm text-[var(--text-1)] leading-relaxed italic border-l-2 border-transparent pl-0">
                              “<Marked text={a.text} q={query} />”
                            </blockquote>

                            {a.note && (
                              <div className="flex items-start gap-2 p-2 rounded-[var(--r-sm)] bg-[var(--layer-1)] text-xs text-[var(--text-2)] border border-[var(--stroke)]">
                                <StickyNote className="w-3.5 h-3.5 text-[var(--accent)] shrink-0 mt-0.5" />
                                <div>
                                  <Marked text={a.note} q={query} />
                                </div>
                              </div>
                            )}

                            <div className="flex items-center justify-between text-[11px] text-[var(--text-3)] pt-1">
                              <span>
                                {a.chapter && <span className="font-medium">{a.chapter} · </span>}
                                {fmtDate(a.created_at)}
                              </span>
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--accent)] font-medium inline-flex items-center gap-1">
                                Go to page <ExternalLink className="w-3 h-3" />
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}