import React from 'react';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}) => {
  const checkboxElement = (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={twMerge(
        clsx(
          'flex items-center justify-center w-[18px] h-[18px] rounded-[var(--r-sm)] border border-[var(--stroke-strong)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] shrink-0',
          checked === true ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]' : 'bg-[var(--layer-2)] text-transparent',
          disabled && 'opacity-40 pointer-events-none',
          className,
        ),
      )}
    >
      <RadixCheckbox.Indicator>
        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );

  if (!label) return checkboxElement;

  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm text-[var(--text-1)]">
      {checkboxElement}
      <span>{label}</span>
    </label>
  );
};
