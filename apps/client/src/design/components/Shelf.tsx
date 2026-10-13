import { useRef, useState, useEffect, type FC, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export interface ShelfProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export const Shelf: FC<ShelfProps> = ({ title, action, children, className }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [children]);

  const scrollBy = (offset: number) => {
    scrollRef.current?.scrollBy({ left: offset, behavior: 'smooth' });
  };

  return (
    <section className={twMerge('relative flex flex-col group/shelf my-4', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-3 px-1">
          {title && (
            <h2 className="text-base sm:text-lg font-semibold text-[var(--text-1)] tracking-tight">
              {title}
            </h2>
          )}
          {action && <div className="text-xs sm:text-sm font-medium text-[var(--accent)]">{action}</div>}
        </div>
      )}

      <div className="relative">
        {/* Left scroll arrow */}
        {canScrollLeft && (
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scrollBy(-320)}
            className="hidden md:flex absolute -left-3 top-[40%] -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] items-center justify-center opacity-0 group-hover/shelf:opacity-100 transition-opacity cursor-pointer hover:bg-[var(--layer-3)] outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Scrollable track */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth no-scrollbar py-2 px-1 snap-x snap-mandatory"
        >
          {children}
        </div>

        {/* Right scroll arrow */}
        {canScrollRight && (
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scrollBy(320)}
            className="hidden md:flex absolute -right-3 top-[40%] -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] items-center justify-center opacity-0 group-hover/shelf:opacity-100 transition-opacity cursor-pointer hover:bg-[var(--layer-3)] outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </section>
  );
};
