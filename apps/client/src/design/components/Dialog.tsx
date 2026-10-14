import React, { useEffect, useRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconButton } from './IconButton';
import { registerBackHandler } from '../../lib/backStack';
import { isAndroidDevice, isTauri } from '../../lib/tauri';

export interface DialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}) => {
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange?.(isOpen);
    if (!isOpen) onClose?.();
  };

  // Android back closes the dialog instead of leaving the page behind it.
  const closeRef = useRef(handleOpenChange);
  closeRef.current = handleOpenChange;
  useEffect(() => {
    if (!open || !isTauri() || !isAndroidDevice()) return;
    return registerBackHandler(() => {
      closeRef.current(false);
      return true;
    }, 60);
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={handleOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-150" />
        <RadixDialog.Content
          className={twMerge(
            clsx(
              // Never taller than the screen: content scrolls inside (on phones the
              // action buttons used to end up below the bottom edge).
              'fixed left-[50%] top-[50%] z-50 w-[calc(100vw-1.5rem)] sm:w-[90vw] max-w-[560px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto translate-x-[-50%] translate-y-[-50%] rounded-[var(--r-lg)] bg-[var(--layer-solid)] p-4 sm:p-6 shadow-[var(--shadow-flyout)] border border-[var(--stroke)] focus:outline-none animate-in fade-in-0 zoom-in-95 duration-150 text-[var(--text-1)]',
              className,
            ),
          )}
        >
          <div className="flex items-start justify-between gap-4 mb-3 sm:mb-4">
            <div className="min-w-0">
              {title && (
                <RadixDialog.Title className="text-base sm:text-lg font-semibold text-[var(--text-1)] leading-snug [overflow-wrap:anywhere]">
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
