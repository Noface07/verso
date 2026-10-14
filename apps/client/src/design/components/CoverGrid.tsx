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
          'grid gap-3 sm:gap-5 py-4',
          selectionMode && 'select-none',
          className,
        ),
      )}
      style={{
        // Phones get three smaller covers per row instead of two huge ones
        // (1.5rem = the two phone-width gaps).
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${columnWidth}px, calc((100% - 1.5rem) / 3)), 1fr))`,
      }}
    >
      {children}
    </div>
  );
};
