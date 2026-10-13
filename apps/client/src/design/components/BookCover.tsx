import React, { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db } from '../../db';

export interface BookCoverProps {
  id: string;
  title: string;
  author: string;
  coverHash?: string | null;
  progressPercent?: number; // 0 to 100
  badge?: React.ReactNode;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onClick?: () => void;
  className?: string;
  glow?: boolean;
}

export function useCoverBlobUrl(id: string, coverHash?: string | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    if (coverHash) {
      void db.covers.get(id).then((cover) => {
        if (cover && alive) {
          objectUrl = URL.createObjectURL(cover.blob);
          setUrl(objectUrl);
        }
      });
    } else {
      setUrl(null);
    }

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, coverHash]);

  return url;
}

export const BookCover: React.FC<BookCoverProps> = ({
  id,
  title,
  author,
  coverHash,
  progressPercent,
  badge,
  isFavourite,
  onToggleFavourite,
  onClick,
  className,
  glow = true,
}) => {
  const coverUrl = useCoverBlobUrl(id, coverHash);
  const hue = parseInt(id.slice(0, 6), 16) % 360;
  const fallbackBg = `hsl(${hue} 35% 32%)`;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
      className={twMerge(
        clsx(
          'group relative aspect-[2/3] w-full rounded-[var(--r-cover)] overflow-hidden select-none cursor-pointer',
          'shadow-[var(--shadow-cover)] transition-all duration-[var(--d-normal)] ease-[var(--ease-out)]',
          'hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-[var(--accent)] outline-none',
          glow && 'hover:shadow-[0_18px_40px_rgba(0,0,0,0.55)]',
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
          draggable={false}
          className="w-full h-full object-cover transition-transform duration-[var(--d-slow)] group-hover:scale-102"
        />
      ) : (
        <div
          className="w-full h-full flex flex-col justify-end p-3 text-white transition-colors"
          style={{ background: fallbackBg }}
        >
          <span className="font-display font-semibold text-sm leading-tight line-clamp-3 mb-1 drop-shadow-sm">
            {title}
          </span>
          <span className="text-[11px] text-white/80 line-clamp-1">{author}</span>
        </div>
      )}

      {/* Badge slot */}
      {badge && (
        <div className="absolute top-2 left-2 z-20 pointer-events-none">
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
