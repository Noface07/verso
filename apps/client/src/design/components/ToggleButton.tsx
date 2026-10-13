import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Tooltip } from './Tooltip';

export interface ToggleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  onPressedChange?: (pressed: boolean) => void;
  label: string;
  icon: ReactNode;
  activeIcon?: ReactNode;
  children?: ReactNode;
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(
  (
    {
      pressed,
      onPressedChange,
      label,
      icon,
      activeIcon,
      children,
      className,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (!e.defaultPrevented) {
        onPressedChange?.(!pressed);
      }
    };

    const displayIcon = pressed && activeIcon ? activeIcon : icon;

    const button = (
      <button
        ref={ref}
        type="button"
        aria-pressed={pressed}
        aria-label={label}
        disabled={disabled}
        onClick={handleClick}
        className={twMerge(
          clsx(
            'inline-flex items-center justify-center gap-1.5 h-[32px] px-2.5 rounded-[var(--r-md)] text-sm font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-40 select-none',
            pressed
              ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[color-mix(in_oklab,var(--accent)_30%,transparent)]'
              : 'bg-transparent hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] text-[var(--text-2)] border-transparent',
            className,
          ),
        )}
        {...props}
      >
        <span className="shrink-0">{displayIcon}</span>
        {children && <span>{children}</span>}
      </button>
    );

    return <Tooltip content={label}>{button}</Tooltip>;
  },
);

ToggleButton.displayName = 'ToggleButton';
