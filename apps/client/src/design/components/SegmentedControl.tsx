import React, { useRef, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector<HTMLButtonElement>(`[data-active="true"]`);
    if (activeEl) {
      setIndicatorStyle({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
      });
    }
  }, [value, options]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      className={twMerge(
        clsx(
          'relative inline-flex items-center p-1 bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-pill)] select-none',
          size === 'sm' ? 'h-[28px]' : 'h-[36px]',
          className,
        ),
      )}
    >
      {/* Sliding thumb */}
      {indicatorStyle.width > 0 && (
        <div
          className="absolute top-1 bottom-1 bg-[var(--layer-solid)] rounded-[var(--r-pill)] shadow-sm transition-all duration-[var(--d-normal)] ease-[var(--ease-out)] pointer-events-none border border-[var(--stroke)]"
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
          }}
        />
      )}

      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-active={isActive}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'relative z-10 inline-flex items-center justify-center gap-1.5 px-3 h-full rounded-[var(--r-pill)] font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              size === 'sm' ? 'text-xs' : 'text-sm',
              isActive
                ? 'text-[var(--text-1)] font-semibold'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]',
            )}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
