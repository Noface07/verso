import React from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}) => {
  const switchElement = (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={twMerge(
        clsx(
          'relative w-[40px] h-[22px] rounded-full transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] border border-[var(--stroke)] shrink-0',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--layer-3)]',
          disabled && 'opacity-40 pointer-events-none',
          className,
        ),
      )}
    >
      <RadixSwitch.Thumb
        className={clsx(
          'block w-[16px] h-[16px] rounded-full bg-[var(--layer-solid)] transition-transform duration-[var(--d-fast)] ease-[var(--ease-out)] shadow-xs',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
    </RadixSwitch.Root>
  );

  if (!label) return switchElement;

  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer select-none py-1">
      <span className="text-sm font-medium text-[var(--text-1)]">{label}</span>
      {switchElement}
    </label>
  );
};
