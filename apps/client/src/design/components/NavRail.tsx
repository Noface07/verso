import React, { useState, useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Menu,
  Home,
  BookOpen,
  BookMarked,
  ShoppingBag,
  Sparkles,
  BarChart2,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Tooltip } from './Tooltip';

export interface NavRailItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number | string;
}

export const MAIN_NAV_ITEMS: NavRailItem[] = [
  { to: '/', label: 'Home', icon: <Home className="w-5 h-5" /> },
  { to: '/library', label: 'Library', icon: <BookOpen className="w-5 h-5" /> },
  { to: '/notebook', label: 'Notebook', icon: <BookMarked className="w-5 h-5" /> },
  { to: '/store', label: 'Store', icon: <ShoppingBag className="w-5 h-5" /> },
  { to: '/updates', label: 'Updates', icon: <Sparkles className="w-5 h-5" /> },
  { to: '/stats', label: 'Statistics', icon: <BarChart2 className="w-5 h-5" /> },
];

export interface NavRailProps {
  syncStatus?: 'idle' | 'syncing' | 'error' | 'offline';
  className?: string;
  onOpenSettings?: () => void;
}

export const NavRail: React.FC<NavRailProps> = ({
  syncStatus = 'idle',
  className,
  onOpenSettings,
}) => {
  const [expanded, setExpanded] = useState(() => {
    return localStorage.getItem('folio_nav_expanded') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('folio_nav_expanded', String(expanded));
  }, [expanded]);

  const syncLabels = {
    idle: 'Sync idle',
    syncing: 'Syncing…',
    error: 'Sync error',
    offline: 'Offline',
  };

  return (
    <aside
      className={twMerge(
        clsx(
          'hidden md:flex flex-col h-full bg-[var(--layer-1)] backdrop-blur-[var(--blur)] border-r border-[var(--stroke)] select-none shrink-0 transition-all duration-[var(--d-slow)] ease-[var(--ease-out)] z-40',
          expanded ? 'w-[260px]' : 'w-[56px]',
          className,
        ),
      )}
    >
      {/* Top hamburger toggle */}
      <div className="h-[48px] flex items-center px-2 shrink-0">
        <button
          type="button"
          aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          onClick={() => setExpanded(!expanded)}
          className="w-10 h-10 rounded-[var(--r-md)] flex items-center justify-center text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Menu className="w-5 h-5" />
        </button>
        {expanded && (
          <span className="font-display font-bold text-lg text-[var(--text-1)] ml-2.5 tracking-tight animate-in fade-in-0 duration-150">
            Folio
          </span>
        )}
      </div>

      {/* Main navigation list */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-3 overflow-y-auto no-scrollbar">
        {MAIN_NAV_ITEMS.map((item) => {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'group relative flex items-center h-[40px] rounded-[var(--r-md)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                  isActive
                    ? 'bg-[var(--layer-2)] text-[var(--text-1)] font-semibold'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-1)] active:bg-[var(--layer-2)]',
                  expanded ? 'px-3 gap-3.5' : 'justify-center px-0',
                )
              }
            >
              {({ isActive }) => {
                const navContent = (
                  <>
                    {/* Animated 3px accent pill for active item */}
                    {isActive && (
                      <span className="absolute left-0 top-[12px] bottom-[12px] w-[3px] bg-[var(--accent)] rounded-r-full" />
                    )}

                    <span className="shrink-0">{item.icon}</span>

                    {expanded && (
                      <span className="truncate text-sm grow">{item.label}</span>
                    )}

                    {item.badge && expanded && (
                      <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </>
                );

                if (!expanded) {
                  return (
                    <Tooltip content={item.label} side="right">
                      <div className="flex items-center justify-center w-full h-full">
                        {navContent}
                      </div>
                    </Tooltip>
                  );
                }

                return navContent;
              }}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer controls: Settings & Sync */}
      <div className="p-2 border-t border-[var(--stroke)] flex flex-col gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpenSettings}
          className={clsx(
            'flex items-center h-[40px] rounded-[var(--r-md)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
            expanded ? 'px-3 gap-3.5' : 'justify-center',
          )}
        >
          {expanded ? (
            <>
              <Settings className="w-5 h-5 shrink-0" />
              <span className="text-sm truncate">Settings</span>
            </>
          ) : (
            <Tooltip content="Settings" side="right">
              <div className="flex items-center justify-center w-full h-full">
                <Settings className="w-5 h-5" />
              </div>
            </Tooltip>
          )}
        </button>

        {/* Sync status indicator */}
        <div
          className={clsx(
            'flex items-center h-[36px] rounded-[var(--r-md)] text-xs text-[var(--text-3)] select-none',
            expanded ? 'px-3 gap-3' : 'justify-center',
          )}
        >
          {expanded ? (
            <>
              <RefreshCw
                className={clsx(
                  'w-4 h-4 shrink-0',
                  syncStatus === 'syncing' && 'animate-spin text-[var(--accent)]',
                  syncStatus === 'error' && 'text-[var(--danger)]',
                )}
              />
              <span className="truncate">{syncLabels[syncStatus]}</span>
            </>
          ) : (
            <Tooltip content={syncLabels[syncStatus]} side="right">
              <div className="flex items-center justify-center w-full h-full">
                <RefreshCw
                  className={clsx(
                    'w-4 h-4',
                    syncStatus === 'syncing' && 'animate-spin text-[var(--accent)]',
                    syncStatus === 'error' && 'text-[var(--danger)]',
                  )}
                />
              </div>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
};
