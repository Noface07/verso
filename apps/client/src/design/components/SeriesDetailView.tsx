import React, { useMemo } from 'react';
import { CheckCircle, Play } from 'lucide-react';
import { type Book, type Progress } from '../../db';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { BookCover } from './BookCover';

export interface SeriesDetailViewProps {
  open: boolean;
  onClose: () => void;
  seriesName: string;
  books: Book[];
  progressMap: Map<string, Progress>;
  onOpenBook: (book: Book) => void;
  favIds: Set<string>;
  onToggleFavorite: (bookId: string) => void;
}

export const SeriesDetailView: React.FC<SeriesDetailViewProps> = ({
  open,
  onClose,
  seriesName,
  books,
  progressMap,
  onOpenBook,
  favIds,
  onToggleFavorite,
}) => {
  // Sort books by series_number ascending, then by title
  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      const numA = a.meta.series_number ?? 999999;
      const numB = b.meta.series_number ?? 999999;
      if (numA !== numB) return numA - numB;
      return a.title.localeCompare(b.title);
    });
  }, [books]);

  // Compute overall progress
  const { avgPercent, completedCount, nextBookToRead } = useMemo(() => {
    if (sortedBooks.length === 0) {
      return { avgPercent: 0, completedCount: 0, nextBookToRead: null };
    }
    let totalPct = 0;
    let completed = 0;
    let next: Book | null = null;

    for (const b of sortedBooks) {
      const p = progressMap.get(b.id)?.percent ?? 0;
      totalPct += p;
      if (p >= 0.99 || b.meta.finished_at) {
        completed++;
      } else if (!next) {
        next = b;
      }
    }

    return {
      avgPercent: Math.round((totalPct / sortedBooks.length) * 100),
      completedCount: completed,
      nextBookToRead: next ?? sortedBooks[0],
    };
  }, [sortedBooks, progressMap]);

  if (!open) return null;

  const leadBook = sortedBooks[0];
  const author = leadBook?.author ?? 'Unknown author';

  return (
    <Dialog open={open} onClose={onClose} title={seriesName} className="max-w-2xl max-h-[85vh]">
      <div className="space-y-6">
        {/* Series Header Hero Card */}
        <div className="flex flex-col sm:flex-row gap-5 p-4 rounded-xl bg-[var(--layer-2)] border border-[var(--stroke)] items-center sm:items-start">
          {leadBook && (
            <div className="w-24 shrink-0 shadow-md">
              <BookCover
                id={leadBook.id}
                title={leadBook.title}
                author={leadBook.author}
                coverHash={leadBook.cover_hash}
                className="w-24 pointer-events-none"
              />
            </div>
          )}

          <div className="flex-1 text-center sm:text-left space-y-3">
            <div>
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--accent)]">
                Book Series
              </span>
              <h3 className="text-lg font-bold text-[var(--text-1)] mt-0.5 leading-tight">
                {seriesName}
              </h3>
              <p className="text-xs text-[var(--text-2)] mt-0.5">by {author}</p>
            </div>

            {/* Combined Progress */}
            <div className="space-y-1.5 max-w-sm mx-auto sm:mx-0">
              <div className="flex justify-between text-xs text-[var(--text-2)] font-medium">
                <span>
                  {completedCount} of {sortedBooks.length} volumes read
                </span>
                <span className="text-[var(--accent)]">{avgPercent}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--layer-3)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full transition-all duration-[var(--d-normal)]"
                  style={{ width: `${avgPercent}%` }}
                />
              </div>
            </div>

            {/* Continue Reading Action */}
            {nextBookToRead && (
              <div className="pt-1">
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => {
                    onOpenBook(nextBookToRead);
                    onClose();
                  }}
                  className="gap-2 text-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Continue reading: {nextBookToRead.title}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Volumes List */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-3 px-1">
            Volumes in Series ({sortedBooks.length})
          </h4>

          <div className="space-y-2">
            {sortedBooks.map((book) => {
              const p = progressMap.get(book.id)?.percent ?? 0;
              const isFinished = p >= 0.99 || !!book.meta.finished_at;
              const pctDisplay = Math.round(p * 100);

              return (
                <div
                  key={book.id}
                  onClick={() => {
                    onOpenBook(book);
                    onClose();
                  }}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--layer-2)] hover:bg-[var(--layer-3)] border border-[var(--stroke)] transition-colors cursor-pointer group select-none"
                >
                  <div className="w-12 shrink-0">
                    <BookCover
                      id={book.id}
                      title={book.title}
                      author={book.author}
                      coverHash={book.cover_hash}
                      isFavourite={favIds.has(book.id)}
                      onToggleFavourite={() => onToggleFavorite(book.id)}
                      className="w-12 pointer-events-none"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {book.meta.series_number !== undefined && (
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--layer-3)] text-[var(--text-2)] shrink-0">
                          Vol. {book.meta.series_number}
                        </span>
                      )}
                      <h5 className="text-xs font-medium text-[var(--text-1)] truncate group-hover:text-[var(--accent)] transition-colors">
                        {book.title}
                      </h5>
                    </div>
                    <p className="text-[11px] text-[var(--text-3)] truncate mt-0.5">
                      {book.format} • {book.author}
                    </p>
                  </div>

                  {/* Progress status */}
                  <div className="text-right shrink-0 pr-1">
                    {isFinished ? (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--success)] font-medium">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Finished
                      </span>
                    ) : p > 0 ? (
                      <span className="text-xs text-[var(--accent)] font-medium">
                        {pctDisplay}%
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-3)]">Unread</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
