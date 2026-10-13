import React, { forwardRef, useRef, useImperativeHandle, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SearchBoxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  shortcutHint?: boolean;
}

export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(
  ({ value, onChange, onClear, placeholder = 'Search…', shortcutHint = true, className, ...props }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          inputRef.current?.focus();
        } else if (e.key === '/' && document.activeElement !== inputRef.current && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleClear = () => {
      onChange('');
      onClear?.();
      inputRef.current?.focus();
    };

    return (
      <div
        className={twMerge(
          clsx(
            'relative flex items-center h-[34px] bg-[var(--layer-2)] border border-[var(--stroke)] hover:border-[var(--stroke-strong)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)] rounded-[var(--r-md)] transition-colors px-2.5 gap-2 text-sm text-[var(--text-1)]',
            className,
          ),
        )}
      >
        <Search className="w-4 h-4 text-[var(--text-3)] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent outline-none placeholder:text-[var(--text-3)] text-sm"
          {...props}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={handleClear}
            className="p-0.5 rounded-[var(--r-sm)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--layer-3)] cursor-pointer outline-none"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : shortcutHint ? (
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-3)] bg-[var(--layer-1)] border border-[var(--stroke)] rounded-[var(--r-sm)] select-none">
            Ctrl+K
          </kbd>
        ) : null}
      </div>
    );
  },
);

SearchBox.displayName = 'SearchBox';
