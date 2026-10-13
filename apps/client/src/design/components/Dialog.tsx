import React, { type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}) => {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150" />
        <RadixDialog.Content
          className={twMerge(
            clsx(
              'fixed left-[50%] top-[50%] z-50 w-[90vw] max-w-[560px] translate-x-[-50%] translate-y-[-50%] rounded-[var(--r-lg)] bg-[var(--layer-solid)] p-6 shadow-[var(--shadow-flyout)] border border-[var(--stroke)] focus:outline-none animate-in fade-in-0 zoom-in-95 duration-150 text-[var(--text-1)]',
              className,
            ),
          )}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              {title && (
                <RadixDialog.Title className="text-lg font-semibold text-[var(--text-1)]">
                  {title}
                </RadixDialog.Title>
              )}
              {description && (
                <RadixDialog.Description className="text-sm text-[var(--text-2)] mt-1">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-4 h-4" />} size="sm" variant="subtle" />
            </RadixDialog.Close>
          </div>

          <div className="text-sm">{children}</div>

          {footer && <div className="mt-6 flex justify-end gap-2.5">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};
