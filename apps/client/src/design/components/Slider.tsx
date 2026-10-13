import React from 'react';
import * as RadixSlider from '@radix-ui/react-slider';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SliderProps {
  value: number[];
  onValueChange: (val: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  className?: string;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  ariaLabel = 'Slider',
  className,
}) => {
  return (
    <RadixSlider.Root
      value={value}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      className={twMerge('relative flex items-center select-none touch-none w-full h-5 cursor-pointer', className)}
    >
      <RadixSlider.Track className="relative grow h-[4px] bg-[var(--layer-3)] rounded-full overflow-hidden">
        <RadixSlider.Range className="absolute h-full bg-[var(--accent)] rounded-full" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={ariaLabel}
        className={clsx(
          'block w-4 h-4 bg-[var(--layer-solid)] border-2 border-[var(--accent)] rounded-full shadow-md outline-none transition-transform',
          'hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
        )}
      />
    </RadixSlider.Root>
  );
};
