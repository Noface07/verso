import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AmbientBackdropProps {
  coverUrl?: string | null;
  enabled?: boolean;
  className?: string;
}

export const AmbientBackdrop: React.FC<AmbientBackdropProps> = ({
  coverUrl,
  enabled = true,
  className,
}) => {
  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      className={twMerge(
        clsx(
          'fixed inset-0 pointer-events-none z-0 overflow-hidden select-none',
          className,
        ),
      )}
    >
      {coverUrl ? (
        <div
          className="absolute inset-[-10%] bg-cover bg-center transition-all duration-[var(--d-slow)] ease-[var(--ease-out)] scale-120"
          style={{
            backgroundImage: `url(${coverUrl})`,
            filter: 'blur(90px) saturate(1.4)',
            opacity: 'var(--bg-ambient-opacity)',
          }}
        />
      ) : (
        <div
          className="absolute inset-0 transition-all duration-[var(--d-slow)] opacity-100"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 20%, color-mix(in oklab, var(--accent) 12%, transparent) 0%, transparent 100%)',
          }}
        />
      )}
    </div>
  );
};
