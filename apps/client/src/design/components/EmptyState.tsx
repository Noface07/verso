import React, { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'flex flex-col items-center justify-center text-center p-8 max-w-[420px] mx-auto select-none',
          className,
        ),
      )}
    >
      {icon && (
        <div className="w-14 h-14 rounded-full bg-[var(--layer-2)] border border-[var(--stroke)] flex items-center justify-center text-[var(--accent)] mb-4 shrink-0 shadow-xs">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--text-1)] mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-[var(--text-2)] mb-5 max-w-[340px] leading-relaxed">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};
