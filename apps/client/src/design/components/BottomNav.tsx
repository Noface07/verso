import { useState, type FC } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, BookOpen, ShoppingBag, BookMarked, MoreHorizontal, BarChart2, Sparkles, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { Dialog } from './Dialog';

export interface BottomNavProps {
  onOpenSettings?: () => void;
}

export const BottomNav: FC<BottomNavProps> = ({ onOpenSettings }) => {
  const [moreOpen, setMoreOpen] = useState(false);

  const mainItems = [
    { to: '/', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { to: '/library', label: 'Library', icon: <BookOpen className="w-5 h-5" /> },
    { to: '/store', label: 'Store', icon: <ShoppingBag className="w-5 h-5" /> },
    { to: '/notebook', label: 'Notebook', icon: <BookMarked className="w-5 h-5" /> },
  ];

  return (
    <>
      <nav
        aria-label="Bottom navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-[56px] pb-safe bg-[var(--layer-1)] backdrop-blur-[var(--blur)] border-t border-[var(--stroke)] flex items-center justify-around px-2 select-none"
      >
        {mainItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex flex-col items-center justify-center min-w-[56px] min-h-[44px] rounded-[var(--r-md)] text-[10px] font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                isActive
                  ? 'text-[var(--accent)] font-semibold'
                  : 'text-[var(--text-2)] hover:text-[var(--text-1)]',
              )
            }
          >
            {item.icon}
            <span className="mt-0.5">{item.label}</span>
          </NavLink>
        ))}

        {/* More button */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center justify-center min-w-[56px] min-h-[44px] rounded-[var(--r-md)] text-[10px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="mt-0.5">More</span>
        </button>
      </nav>

      {/* More actions sheet */}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title="More Options">
        <div className="flex flex-col gap-2 py-2">
          <NavLink
            to="/stats"
            onClick={() => setMoreOpen(false)}
            className="flex items-center gap-3.5 p-3 rounded-[var(--r-md)] hover:bg-[var(--layer-2)] text-sm font-medium text-[var(--text-1)]"
          >
            <BarChart2 className="w-5 h-5 text-[var(--accent)]" />
            <span>Reading Statistics</span>
          </NavLink>
          <NavLink
            to="/updates"
            onClick={() => setMoreOpen(false)}
            className="flex items-center gap-3.5 p-3 rounded-[var(--r-md)] hover:bg-[var(--layer-2)] text-sm font-medium text-[var(--text-1)]"
          >
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
            <span>Manga & Book Updates</span>
          </NavLink>
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              onOpenSettings?.();
            }}
            className="flex items-center gap-3.5 p-3 rounded-[var(--r-md)] hover:bg-[var(--layer-2)] text-sm font-medium text-[var(--text-1)] text-left cursor-pointer"
          >
            <Settings className="w-5 h-5 text-[var(--accent)]" />
            <span>Settings</span>
          </button>
        </div>
      </Dialog>
    </>
  );
};
