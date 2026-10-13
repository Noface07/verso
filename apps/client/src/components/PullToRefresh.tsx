import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { triggerHaptic } from '../lib/mobileUx';

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  className?: string;
}

const THRESHOLD = 64;

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  children,
  onRefresh,
  disabled = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasTriggeredHaptic = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0 && !isRefreshing) {
        startY.current = e.touches[0]?.clientY ?? 0;
        hasTriggeredHaptic.current = false;
      } else {
        startY.current = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === 0 || isRefreshing) return;
      const currentY = e.touches[0]?.clientY ?? 0;
      const delta = currentY - startY.current;

      if (delta > 0 && el.scrollTop <= 0) {
        // Apply dampening
        const dist = Math.min(THRESHOLD * 1.5, delta * 0.45);
        setPullDistance(dist);

        if (dist >= THRESHOLD && !hasTriggeredHaptic.current) {
          triggerHaptic('light');
          hasTriggeredHaptic.current = true;
        }
      }
    };

    const onTouchEnd = async () => {
      if (startY.current === 0 || isRefreshing) return;
      startY.current = 0;

      if (pullDistance >= THRESHOLD) {
        setIsRefreshing(true);
        setPullDistance(THRESHOLD);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [disabled, isRefreshing, onRefresh, pullDistance]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto ${className}`}
      data-testid="pull-to-refresh-container"
    >
      {/* Pull indicator */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 flex items-center justify-center transition-transform duration-150 ease-out z-20"
        style={{
          transform: `translateY(${pullDistance - 40}px)`,
          opacity: pullDistance > 10 ? 1 : 0,
        }}
        aria-hidden="true"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-md border border-[var(--border-subtle)]">
          {isRefreshing ? (
            <svg
              className="h-5 w-5 animate-spin text-[var(--accent)]"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className="h-5 w-5 text-[var(--text-muted)] transition-transform duration-200"
              style={{
                transform: `rotate(${Math.min(180, (pullDistance / THRESHOLD) * 180)}deg)`,
              }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          )}
        </div>
      </div>

      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isRefreshing ? 'transform 0.2s ease-out' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
};
