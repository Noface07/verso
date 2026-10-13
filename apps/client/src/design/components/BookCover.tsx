import React, { useEffect, useRef, useState } from 'react';
import { Heart, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db } from '../../db';

export interface BookCoverProps {
  id: string;
  title: string;
  author: string;
  coverHash?: string | null;
  coverUrl?: string | null;
  progressPercent?: number; // 0 to 100
  badge?: React.ReactNode;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onClick?: () => void;
  className?: string;
  glow?: boolean;
  isSelected?: boolean;
  isSelectable?: boolean;
  onToggleSelect?: () => void;
}

// Shared, ref-counted object URLs for cover blobs. Previously every mounted cover
// read IndexedDB and minted its own object URL, so switching pages re-read and
// re-decoded every cover. URLs are revoked a little after their last user goes
// away, so quick back-and-forth navigation reuses them.
interface CoverEntry {
  url: Promise<string | null>;
  refs: number;
  revokeTimer?: ReturnType<typeof setTimeout>;
}
const coverUrls = new Map<string, CoverEntry>();
const COVER_URL_GRACE_MS = 30_000;

function acquireCoverUrl(id: string, coverHash: string): Promise<string | null> {
  const key = `${id}:${coverHash}`;
  let entry = coverUrls.get(key);
  if (!entry) {
    entry = {
      refs: 0,
      url: db.covers
        .get(id)
        .then((cover) => (cover ? URL.createObjectURL(cover.blob) : null))
        .catch(() => null),
    };
    coverUrls.set(key, entry);
  }
  if (entry.revokeTimer) {
    clearTimeout(entry.revokeTimer);
    entry.revokeTimer = undefined;
  }
  entry.refs++;
  return entry.url;
}

function releaseCoverUrl(id: string, coverHash: string): void {
  const key = `${id}:${coverHash}`;
  const entry = coverUrls.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  entry.revokeTimer = setTimeout(() => {
    coverUrls.delete(key);
    void entry.url.then((u) => u && URL.revokeObjectURL(u));
  }, COVER_URL_GRACE_MS);
}

/** Object URL for a stored cover. Pass `enabled: false` to defer loading (e.g. off-screen). */
export function useCoverBlobUrl(id: string, coverHash?: string | null, enabled = true) {
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  const key = coverHash ? `${id}:${coverHash}` : null;

  useEffect(() => {
    if (!coverHash || !enabled) return;
    let alive = true;
    void acquireCoverUrl(id, coverHash).then((url) => {
      if (alive) setLoaded({ key: `${id}:${coverHash}`, url });
    });
    return () => {
      alive = false;
      releaseCoverUrl(id, coverHash);
    };
  }, [id, coverHash, enabled]);

  return key && loaded?.key === key ? loaded.url : null;
}

/** True once the element has come within `margin` of the viewport (stays true). */
function useNearViewport<T extends Element>(ref: React.RefObject<T | null>, margin = '600px') {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, margin, seen]);
  return seen;
}

export const BookCover: React.FC<BookCoverProps> = ({
  id,
  title,
  author,
  coverHash,
  coverUrl: coverUrlProp,
  progressPercent,
  badge,
  isFavourite,
  onToggleFavourite,
  onClick,
  className,
  glow = true,
  isSelected = false,
  isSelectable = false,
  onToggleSelect,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const nearViewport = useNearViewport(rootRef);
  const blobCoverUrl = useCoverBlobUrl(id, coverHash, nearViewport && !coverUrlProp);
  const coverUrl = coverUrlProp || blobCoverUrl;
  const hue = parseInt(id.slice(0, 6), 16) % 360;
  const fallbackBg = `hsl(${hue} 35% 32%)`;

  const handleClick = () => {
    if (isSelectable) {
      onToggleSelect?.();
    } else {
      onClick?.();
    }
  };

  return (
    <div
      ref={rootRef}
      role={onClick || isSelectable ? 'button' : undefined}
      tabIndex={onClick || isSelectable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      className={twMerge(
        clsx(
          'group relative aspect-[2/3] w-full rounded-[var(--r-cover)] overflow-hidden select-none cursor-pointer',
          'shadow-[var(--shadow-cover)] transition-all duration-[var(--d-normal)] ease-[var(--ease-out)]',
          'hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-[var(--accent)] outline-none',
          glow && 'hover:shadow-[0_18px_40px_rgba(0,0,0,0.55)]',
          isSelected && 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-base)]',
          className,
        ),
      )}
    >
      {/* 2px inner spine highlight */}
      <div className="absolute inset-y-0 left-0 w-2 z-20 pointer-events-none bg-gradient-to-r from-white/15 to-transparent" />

      {/* Cover Image or Fallback */}
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={title}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full h-full object-cover transition-transform duration-[var(--d-slow)] group-hover:scale-102"
        />
      ) : (
        // Sized off the cover's own width (container query units) so the same
        // component reads well as a 44px thumbnail and as a 300px hero.
        <div
          className="@container w-full h-full text-white transition-colors"
          style={{ background: fallbackBg }}
        >
          <div className="w-full h-full hidden @min-[72px]:flex flex-col justify-end p-[8cqw] min-w-0">
            <span className="font-display font-semibold text-[clamp(10px,9.5cqw,22px)] leading-tight line-clamp-3 mb-[0.25em] drop-shadow-sm [overflow-wrap:anywhere]">
              {title}
            </span>
            <span className="text-[clamp(9px,7.5cqw,15px)] text-white/80 line-clamp-1 [overflow-wrap:anywhere]">
              {author}
            </span>
          </div>
          <div className="w-full h-full flex @min-[72px]:hidden items-center justify-center font-display font-semibold text-[40cqw] leading-none drop-shadow-sm">
            {title.trim().charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Selection checkbox */}
      {isSelectable && (
        <button
          type="button"
          aria-label={isSelected ? 'Deselect book' : 'Select book'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className={clsx(
            'absolute top-2 left-2 z-30 w-6 h-6 rounded-md flex items-center justify-center transition-all cursor-pointer outline-none border shadow-xs',
            isSelected
              ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]'
              : 'bg-black/60 border-white/50 text-transparent hover:border-white',
          )}
        >
          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>
      )}

      {/* Badge slot */}
      {badge && (
        <div
          className={clsx(
            'absolute z-20 pointer-events-none',
            isSelectable ? 'top-2 left-10' : 'top-2 left-2',
          )}
        >
          {badge}
        </div>
      )}

      {/* Favourite Heart button on hover */}
      {onToggleFavourite && (
        <button
          type="button"
          aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite();
          }}
          className={clsx(
            'absolute top-2 right-2 z-20 w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer outline-none',
            isFavourite
              ? 'bg-black/60 text-[var(--accent)] opacity-100 shadow-xs'
              : 'bg-black/50 text-white/80 opacity-0 group-hover:opacity-100 hover:text-white',
          )}
        >
          <Heart className={clsx('w-3.5 h-3.5', isFavourite && 'fill-current')} />
        </button>
      )}

      {/* Progress Bar overlay on bottom scrim */}
      {progressPercent !== undefined && progressPercent > 0 && (
        <div className="absolute inset-x-0 bottom-0 pt-6 pb-2 px-2.5 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
          <div className="w-full h-[3px] bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all duration-[var(--d-fast)]"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
