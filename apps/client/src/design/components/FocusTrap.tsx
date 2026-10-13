import React, { useEffect, useRef } from 'react';

export interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  onClose?: () => void;
  className?: string;
  autoFocus?: boolean;
  restoreFocus?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isFocusableVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) {
    return false;
  }
  if (el.style.display === 'none' || el.style.visibility === 'hidden') {
    return false;
  }
  if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) {
    let cur: HTMLElement | null = el;
    while (cur) {
      if (cur.style.display === 'none' || cur.style.visibility === 'hidden' || cur.hasAttribute('hidden')) {
        return false;
      }
      cur = cur.parentElement;
    }
  }
  return true;
}

export function FocusTrap({
  children,
  active = true,
  onClose,
  className,
  autoFocus = true,
  restoreFocus = true,
}: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    if (autoFocus && containerRef.current) {
      // Small timeout to allow children to mount and layout
      const timer = window.setTimeout(() => {
        if (!containerRef.current) return;
        const focusables = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter(isFocusableVisible);

        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          containerRef.current.focus();
        }
      }, 30);
      return () => window.clearTimeout(timer);
    }
  }, [active, autoFocus]);

  useEffect(() => {
    return () => {
      if (restoreFocus && previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [restoreFocus]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!active || !containerRef.current) return;

    if (e.key === 'Escape' && onClose) {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(isFocusableVisible);

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !containerRef.current.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !containerRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={className}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  );
}
