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
          'grid gap-5 py-4',
          selectionMode && 'select-none',
          className,
        ),
      )}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, 1fr))`,
      }}
    >
      {children}
    </div>
  );
};
