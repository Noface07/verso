import { Fragment, type FC, type ReactNode } from 'react';
import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface DropdownMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
  subItems?: DropdownMenuItem[];
}

export interface DropdownMenuSection {
  title?: string;
  items: DropdownMenuItem[];
}

export interface DropdownProps {
  trigger: ReactNode;
  sections: DropdownMenuSection[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export const Dropdown: FC<DropdownProps> = ({
  trigger,
  sections,
  align = 'start',
  side = 'bottom',
  className,
}) => {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          side={side}
          sideOffset={6}
          className={twMerge(
            clsx(
              'z-50 min-w-[180px] p-1.5 rounded-[var(--r-md)] bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] outline-none animate-in fade-in-0 duration-150',
              className,
            ),
          )}
        >
          {sections.map((sec, secIdx) => (
            <Fragment key={sec.title ?? secIdx}>
              {sec.title && (
                <RadixDropdown.Label className="px-2.5 py-1 text-[11px] font-semibold text-[var(--text-3)] uppercase tracking-wider select-none">
                  {sec.title}
                </RadixDropdown.Label>
              )}
              {sec.items.map((item) => (
                <RadixDropdown.Item
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
                    {item.checked !== undefined ? (
                      <span className="w-4 h-4 flex items-center justify-center">
                        {item.checked && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                      </span>
                    ) : (
                      item.icon && <span className="w-4 h-4 flex items-center justify-center text-[var(--text-2)]">{item.icon}</span>
                    )}
                    <span>{item.label}</span>
                  </div>
                  {item.shortcut && (
                    <span className="text-xs text-[var(--text-3)] font-mono ml-4">{item.shortcut}</span>
                  )}
                </RadixDropdown.Item>
              ))}
              {secIdx < sections.length - 1 && (
                <RadixDropdown.Separator className="h-[1px] bg-[var(--stroke)] my-1" />
              )}
            </Fragment>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
};
