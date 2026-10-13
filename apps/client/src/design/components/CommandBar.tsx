import React, { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CommandBarProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  leftActions?: ReactNode;
  rightActions?: ReactNode;
  className?: string;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  title,
  subtitle,
  leftActions,
  rightActions,
  className,
}) => {
  return (
    <header
      className={twMerge(
        clsx(
          'sticky top-0 z-30 flex items-center justify-between h-[48px] px-4 bg-[var(--layer-1)] backdrop-blur-[var(--blur)] border-b border-[var(--stroke)] select-none shrink-0 transition-colors',
          className,
        ),
      )}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        {leftActions}
        {title && (
          <div className="flex items-baseline gap-2 overflow-hidden truncate">
            {typeof title === 'string' ? (
              <h1 className="text-base font-semibold text-[var(--text-1)] truncate tracking-tight">{title}</h1>
            ) : (
              title
            )}
            {subtitle && (
              <span className="text-xs text-[var(--text-3)] truncate hidden sm:inline">{subtitle}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {rightActions}
      </div>
    </header>
  );
};
