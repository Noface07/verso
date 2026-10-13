import React, { type ReactNode } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DropdownMenuSection } from './Dropdown';

export interface ContextMenuProps {
  children: ReactNode;
  sections: DropdownMenuSection[];
  className?: string;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ children, sections, className }) => {
  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>{children}</RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content
          className={twMerge(
            clsx(
              'z-50 min-w-[190px] p-1.5 rounded-[var(--r-md)] bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] outline-none animate-in fade-in-0 duration-150',
              className,
            ),
          )}
        >
          {sections.map((sec, secIdx) => (
            <React.Fragment key={sec.title ?? secIdx}>
              {sec.title && (
                <RadixContextMenu.Label className="px-2.5 py-1 text-[11px] font-semibold text-[var(--text-3)] uppercase tracking-wider select-none">
                  {sec.title}
                </RadixContextMenu.Label>
              )}
              {sec.items.map((item) => (
                <RadixContextMenu.Item
                  key={item.key}
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  className={clsx(
                    'flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-[var(--r-sm)] text-sm cursor-pointer select-none outline-none transition-colors',
                    item.disabled && 'opacity-40 pointer-events-none',
                    item.danger
                      ? 'text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_18%,transparent)]'
                      : 'text-[var(--text-1)] hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {item.icon && <span className="w-4 h-4 flex items-center justify-center text-[var(--text-2)]">{item.icon}</span>}
                    <span>{item.label}</span>
                  </div>
                  {item.shortcut && (
                    <span className="text-xs text-[var(--text-3)] font-mono ml-4">{item.shortcut}</span>
                  )}
                </RadixContextMenu.Item>
              ))}
              {secIdx < sections.length - 1 && (
                <RadixContextMenu.Separator className="h-[1px] bg-[var(--stroke)] my-1" />
              )}
            </React.Fragment>
          ))}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
};
