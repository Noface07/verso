import type { ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export const TooltipProvider = RadixTooltip.Provider;

export const Tooltip = ({ content, children, side = 'top', align = 'center' }: TooltipProps) => {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-50 px-2.5 py-1 text-xs font-medium text-[var(--text-1)] bg-[var(--layer-solid)] border border-[var(--stroke)] rounded-[var(--r-sm)] shadow-[var(--shadow-flyout)] animate-in fade-in-0 duration-150 select-none"
        >
          {content}
          <RadixTooltip.Arrow className="fill-[var(--layer-solid)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
};
