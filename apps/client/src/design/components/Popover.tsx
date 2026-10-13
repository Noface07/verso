import React, { type ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  className?: string;
}

export const Popover: React.FC<PopoverProps> = ({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'center',
  side = 'bottom',
  sideOffset = 6,
  className,
}) => {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={twMerge(
            clsx(
              'z-50 rounded-[var(--r-lg)] bg-[var(--layer-solid)] p-3 text-[var(--text-1)] shadow-[var(--shadow-flyout)] border border-[var(--stroke)] outline-none',
              'animate-in fade-in-0 duration-150 data-[side=bottom]:slide-in-from-top-1.5 data-[side=top]:slide-in-from-bottom-1.5 data-[side=left]:slide-in-from-right-1.5 data-[side=right]:slide-in-from-left-1.5',
              className,
            ),
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
};
