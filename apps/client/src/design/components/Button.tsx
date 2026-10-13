import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type ButtonVariant = 'accent' | 'standard' | 'subtle' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'standard', size = 'md', icon, children, className, disabled, ...props }, ref) => {
    const baseClasses =
      'inline-flex items-center justify-center whitespace-nowrap max-w-full font-medium transition-colors select-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-40';

    const sizeClasses: Record<ButtonSize, string> = {
      sm: 'h-[28px] px-2.5 text-xs rounded-[var(--r-sm)] gap-1.5',
      md: 'h-[32px] px-3.5 text-sm rounded-[var(--r-md)] gap-2',
      lg: 'h-[40px] px-4 text-base rounded-[var(--r-md)] gap-2.5',
    };

    const variantClasses: Record<ButtonVariant, string> = {
      accent:
        'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)] shadow-sm font-semibold',
      standard:
        'bg-[var(--layer-2)] hover:bg-[var(--layer-3)] active:bg-[var(--layer-1)] text-[var(--text-1)] border border-[var(--stroke)] shadow-xs',
      subtle:
        'bg-transparent hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] text-[var(--text-1)] border-transparent',
      danger:
        'bg-transparent hover:bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] active:bg-[color-mix(in_oklab,var(--danger)_30%,transparent)] text-[var(--danger)] border border-[color-mix(in_oklab,var(--danger)_35%,transparent)]',
    };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={twMerge(clsx(baseClasses, sizeClasses[size], variantClasses[variant], className))}
        {...props}
      >
        {icon && <span className="inline-flex shrink-0">{icon}</span>}
        {/* inline-flex: callers often put an icon inside children, and preflight makes
            svg display:block, which stacked the icon above the label. */}
        {children && <span className="inline-flex items-center min-w-0 gap-[inherit]">{children}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';
