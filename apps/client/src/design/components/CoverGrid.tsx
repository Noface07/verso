import React, { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CoverGridProps {
  children: ReactNode;
  columnWidth?: number; // min column width, default 150px
  className?: string;
  selectionMode?: boolean;
}

export const CoverGrid: React.FC<CoverGridProps> = ({
  children,
  columnWidth = 150,
  className,
  selectionMode = false,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          // Phones: always three columns; minmax(0, 1fr) keeps long titles from
          // widening a column. Wider screens fill columns of `columnWidth`.
          'grid grid-cols-3 gap-3 sm:gap-5 py-4 sm:[grid-template-columns:var(--cover-cols)]',
          selectionMode && 'select-none',
          className,
        ),
      )}
      style={{ '--cover-cols': `repeat(auto-fill, minmax(${columnWidth}px, 1fr))` } as React.CSSProperties}
    >
      {children}
    </div>
  );
};
