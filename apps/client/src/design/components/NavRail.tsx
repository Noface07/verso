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
  Check,
  CloudOff,
  AlertCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Tooltip } from './Tooltip';
import { Popover } from './Popover';
import { Button } from './Button';
import { useSyncStore } from '../../features/sync/engine';
import { fmtRelativeTime } from '../../lib/format';

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
  syncStatus: syncStatusProp,
  className,
  onOpenSettings,
}) => {
  const [expanded, setExpanded] = useState(() => {
    return localStorage.getItem('folio_nav_expanded') === 'true';
  });

  const {
    status: storeSyncStatus,
    lastSyncAt,
    lastError,
    pendingChanges,
    filesUploadingCount,
    filesUploadingTotal,
    runSync,
  } = useSyncStore();

  const effectiveStatus = syncStatusProp ?? storeSyncStatus;

  useEffect(() => {
    localStorage.setItem('folio_nav_expanded', String(expanded));
  }, [expanded]);

  const syncLabels = {
    idle: 'Synced',
    syncing: 'Syncing…',
    error: 'Sync error',
    offline: 'Offline',
  };

  const syncIcons = {
    idle: <Check className="w-4 h-4 text-[var(--success)] shrink-0" />,
    syncing: <RefreshCw className="w-4 h-4 animate-spin text-[var(--accent)] shrink-0" />,
    offline: <CloudOff className="w-4 h-4 text-[var(--text-3)] shrink-0" />,
    error: <AlertCircle className="w-4 h-4 text-[var(--danger)] shrink-0" />,
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

        {/* Sync status indicator & Popover flyout */}
        <Popover
          side="right"
          align="end"
          trigger={
            <button
              type="button"
              className={clsx(
                'flex items-center h-[36px] w-full rounded-[var(--r-md)] text-xs text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-2)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] select-none',
                expanded ? 'px-3 gap-3' : 'justify-center px-0',
              )}
            >
              {syncIcons[effectiveStatus]}
              {expanded && <span className="truncate">{syncLabels[effectiveStatus]}</span>}
            </button>
          }
        >
          <div className="w-64 flex flex-col gap-3 p-1">
            <div className="flex items-center justify-between border-b border-[var(--stroke)] pb-2">
              <div className="flex items-center gap-2">
                {syncIcons[effectiveStatus]}
                <span className="font-semibold text-sm capitalize">{syncLabels[effectiveStatus]}</span>
              </div>
              {pendingChanges > 0 && (
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  {pendingChanges} pending
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
              <div>Last synced: {fmtRelativeTime(lastSyncAt)}</div>
              {filesUploadingTotal > 0 && (
                <div>Uploading files: {filesUploadingCount} / {filesUploadingTotal}</div>
              )}
              {lastError && (
                <div className="text-[var(--danger)] mt-1 font-mono text-[11px] break-words">
                  {lastError}
                </div>
              )}
            </div>

            <Button
              size="sm"
              variant="accent"
              disabled={effectiveStatus === 'syncing' || effectiveStatus === 'offline'}
              onClick={() => void runSync()}
              className="w-full mt-1"
            >
              {effectiveStatus === 'syncing' ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        </Popover>
      </div>
    </aside>
  );
};
