import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Tooltip } from './Tooltip';

export type IconButtonVariant = 'subtle' | 'standard' | 'accent' | 'danger';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // Mandatory for accessibility & tooltip
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, variant = 'subtle', size = 'md', tooltipSide = 'top', className, disabled, ...props }, ref) => {
    const sizeClasses = {
      sm: 'w-[28px] h-[28px] rounded-[var(--r-sm)]',
      md: 'w-[36px] h-[36px] rounded-[var(--r-md)]',
      lg: 'w-[40px] h-[40px] rounded-[var(--r-md)]',
    };

    const variantClasses: Record<IconButtonVariant, string> = {
      subtle:
        'bg-transparent hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] text-[var(--text-1)] border-transparent',
      standard:
        'bg-[var(--layer-2)] hover:bg-[var(--layer-3)] active:bg-[var(--layer-1)] text-[var(--text-1)] border border-[var(--stroke)] shadow-xs',
      accent:
        'bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)] text-[var(--on-accent)] shadow-sm',
      danger:
        'bg-transparent hover:bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] active:bg-[color-mix(in_oklab,var(--danger)_30%,transparent)] text-[var(--danger)]',
    };

    const button = (
      <button
        ref={ref}
        aria-label={label}
        disabled={disabled}
        className={twMerge(
          clsx(
            'inline-flex items-center justify-center transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-40 select-none shrink-0',
            sizeClasses[size],
            variantClasses[variant],
            className,
          ),
        )}
        {...props}
      >
        {icon}
      </button>
    );

    return <Tooltip content={label} side={tooltipSide}>{button}</Tooltip>;
  },
);

IconButton.displayName = 'IconButton';
