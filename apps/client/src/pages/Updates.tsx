import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Check, ExternalLink, RotateCw, Sparkles } from 'lucide-react';
import { db, type Series } from '../db';
import { mangaDexSource } from '../sources/mangadex';
import type { ChapterInfo } from '../sources/types';
import { openExternalUrl } from '../lib/tauri';
import { CommandBar } from '../design/components/CommandBar';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';
import { EmptyState } from '../design/components/EmptyState';
import { ProgressRing } from '../design/components/Progress';
import { PullToRefresh } from '../components/PullToRefresh';

type Update = ChapterInfo & { seriesId: string };

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Kept for the session so switching tabs doesn't refetch; the button refreshes.
let cache: { key: string; at: number; items: Update[] } | null = null;
const CACHE_MS = 15 * 60 * 1000;

function dayLabel(iso: string | undefined): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Updates() {
  const navigate = useNavigate();
  const followed = useLiveQuery(
    () => db.series.filter((s) => !s.deleted_at && s.source === 'mangadex').toArray(),
    [],
  );
  const readIds = useLiveQuery(
    async () =>
      new Set(
        (await db.chapter_progress.filter((p) => !p.deleted_at && p.read).toArray()).map(
          (p) => p.chapter_id,
        ),
      ),
    [],
    new Set<string>(),
  );

  const [items, setItems] = useState<Update[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const seriesKey = useMemo(
    () => (followed ?? []).map((s) => s.id).sort().join(','),
    [followed],
  );
  const seriesById = useMemo(
    () => new Map<string, Series>((followed ?? []).map((s) => [s.id, s])),
    [followed],
  );

  const load = useCallback(
    async (force: boolean) => {
      if (!seriesKey) return;
      if (!force && cache && cache.key === seriesKey && Date.now() - cache.at < CACHE_MS) {
        setItems(cache.items);
        return;
      }
      const ticket = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const result = await mangaDexSource.recentChapters(
          seriesKey.split(','),
          Date.now() - WINDOW_DAYS * DAY_MS,
        );
        if (ticket !== seq.current) return;
        cache = { key: seriesKey, at: Date.now(), items: result };
        setItems(result);
      } catch (err) {
        if (ticket !== seq.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (ticket === seq.current) setLoading(false);
      }
    },
    [seriesKey],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const groups = useMemo(() => {
    const out: { label: string; items: Update[] }[] = [];
    for (const u of items ?? []) {
      const label = dayLabel(u.publishedAt);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(u);
      else out.push({ label, items: [u] });
    }
    return out;
  }, [items]);

  const unread = (items ?? []).filter((u) => !readIds.has(u.id)).length;

  const open = (u: Update) => {
    if (u.externalUrl) void openExternalUrl(u.externalUrl);
    else navigate(`/read/manga/${encodeURIComponent(u.seriesId)}/${encodeURIComponent(u.id)}`);
  };

  let body: React.ReactNode;
  if (followed === undefined) {
    body = null;
  } else if (followed.length === 0) {
    body = (
      <EmptyState
        icon={<Sparkles className="w-7 h-7" />}
        title="No followed manga yet"
        description="Follow a series in the Store and its new chapters will show up here."
        action={
          <Button variant="accent" onClick={() => navigate('/store')}>
            Browse manga
          </Button>
        }
      />
    );
  } else if (error && !items) {
    body = (
      <EmptyState
        title="Couldn't check for new chapters"
        description={error}
        action={
          <Button variant="standard" icon={<RotateCw className="w-4 h-4" />} onClick={() => void load(true)}>
            Try again
          </Button>
        }
      />
    );
  } else if (!items) {
    body = (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <ProgressRing size={32} />
        <p className="text-sm text-[var(--text-3)]">Checking {followed.length} followed series…</p>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<Check className="w-7 h-7" />}
        title="You're all caught up"
        description={`No new chapters from the series you follow in the last ${WINDOW_DAYS} days.`}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-6 max-w-3xl mx-auto w-full">
        {groups.map((g) => (
          <section key={g.label} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">{g.label}</h2>
            {g.items.map((u) => {
              const s = seriesById.get(u.seriesId);
              const isRead = readIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => open(u)}
                  className={`flex items-center gap-3 p-2.5 rounded-[var(--r-md)] border border-[var(--stroke)] text-left cursor-pointer transition-colors hover:bg-[var(--layer-3)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] outline-none ${
                    isRead ? 'bg-[var(--layer-1)] opacity-60' : 'bg-[var(--layer-2)]'
                  }`}
                >
                  <div className="w-10 shrink-0 aspect-[2/3] rounded-[var(--r-sm)] overflow-hidden bg-[var(--layer-3)]">
                    {s?.cover_url && (
                      <img src={s.cover_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-1)] truncate">{s?.title ?? 'Unknown series'}</p>
                    <p className="text-xs text-[var(--text-2)] truncate">{u.title}</p>
                    <p className="text-[11px] text-[var(--text-3)] truncate">
                      {u.externalUrl ? 'Official release · opens on the publisher’s site' : u.scanlationGroup}
                    </p>
                  </div>
                  {u.externalUrl ? (
                    <ExternalLink className="w-4 h-4 text-[var(--text-3)] shrink-0" />
                  ) : isRead ? (
                    <Check className="w-4 h-4 text-[var(--success)] shrink-0" />
                  ) : (
                    <BookOpen className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  )}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <CommandBar
        title="Updates"
        subtitle={items && items.length > 0 ? `${unread} unread · last ${WINDOW_DAYS} days` : undefined}
        rightActions={
          followed && followed.length > 0 ? (
            <IconButton
              label="Check for new chapters"
              icon={<RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={() => void load(true)}
              disabled={loading}
            />
          ) : undefined
        }
      />
      <PullToRefresh onRefresh={() => load(true)} className="flex-1 px-4 sm:px-6 py-4">
        {body}
      </PullToRefresh>
    </div>
  );
}
