import React, { useRef, useEffect, useState } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  children?: React.ReactNode;
  className?: string;
  listClassName?: string;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onValueChange,
  children,
  className,
  listClassName,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLButtonElement>(`[data-state="active"]`);
    if (activeEl) {
      setIndicatorStyle({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
      });
    }
  }, [value, items]);

  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(val) => onValueChange(val as T)}
      className={twMerge('flex flex-col w-full', className)}
    >
      <div className="relative border-b border-[var(--stroke)]">
        <RadixTabs.List
          ref={listRef}
          className={twMerge('relative flex items-center gap-6 overflow-x-auto no-scrollbar', listClassName)}
        >
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              className={clsx(
                'group relative flex items-center gap-2 py-3 text-sm font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] select-none shrink-0',
                'data-[state=active]:text-[var(--text-1)] data-[state=active]:font-semibold text-[var(--text-2)] hover:text-[var(--text-1)]',
              )}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
              {item.badge && (
                <span className="px-1.5 py-0.2 text-[11px] font-bold rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  {item.badge}
                </span>
              )}
            </RadixTabs.Trigger>
          ))}

          {/* Animated 3px accent underline */}
          {indicatorStyle.width > 0 && (
            <div
              className="absolute bottom-0 h-[3px] bg-[var(--accent)] rounded-t-full transition-all duration-[var(--d-normal)] ease-[var(--ease-out)] pointer-events-none"
              style={{
                left: `${indicatorStyle.left}px`,
                width: `${indicatorStyle.width}px`,
              }}
            />
          )}
        </RadixTabs.List>
      </div>

      {children}
    </RadixTabs.Root>
  );
}

export const TabsContent = RadixTabs.Content;
