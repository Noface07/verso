import React, { type ReactNode } from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type InfoBarSeverity = 'info' | 'success' | 'warning' | 'error';

export interface InfoBarProps {
  severity?: InfoBarSeverity;
  title?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  className?: string;
}

export const InfoBar: React.FC<InfoBarProps> = ({
  severity = 'info',
  title,
  message,
  action,
  onClose,
  className,
}) => {
  const icons = {
    info: <Info className="w-4 h-4 text-[var(--accent)] shrink-0" />,
    success: <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-[var(--warning)] shrink-0" />,
    error: <AlertCircle className="w-4 h-4 text-[var(--danger)] shrink-0" />,
  };

  const borders = {
    info: 'border-[var(--stroke)] bg-[var(--layer-2)]',
    success: 'border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)]',
    warning: 'border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)]',
    error: 'border-[color-mix(in_oklab,var(--danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]',
  };

  return (
    <div
      role="alert"
      className={twMerge(
        clsx(
          // Wraps, so on narrow screens the action moves under the message instead
          // of running off the edge.
          'flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-3 rounded-[var(--r-md)] border text-sm text-[var(--text-1)] shadow-xs animate-in fade-in-0 duration-150',
          borders[severity],
          className,
        ),
      )}
    >
      <div className="flex items-start gap-2.5 grow basis-56 min-w-0">
        <span className="mt-0.5">{icons[severity]}</span>
        <div className="grow">
          {title && <div className="font-semibold text-sm mb-0.5">{title}</div>}
          <div className="text-xs text-[var(--text-2)]">{message}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {action}
        {onClose && (
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={onClose}
            className="p-1 text-[var(--text-3)] hover:text-[var(--text-1)] rounded-[var(--r-sm)] cursor-pointer outline-none"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
