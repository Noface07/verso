import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getAuthUser } from '../features/auth/storage';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock,
  Flame,
  Plus,
  Play,
  Heart,
  CheckCircle,
  Sparkles,
} from 'lucide-react';
import { db, dirty, deviceId, type Book, type Progress, type ReadingSession } from '../db';
import { useFavoriteIds, toggleFavorite } from '../lib/favourites';
import { BookCover, useCoverBlobUrl } from '../design/components/BookCover';
import { BookCard } from '../design/components/BookCard';
import { Shelf } from '../design/components/Shelf';
import { Button } from '../design/components/Button';
import { ContextMenu } from '../design/components/ContextMenu';
import { EmptyState } from '../design/components/EmptyState';
import { CircularProgress } from '../design/components/Progress';
import { useReadingGoals } from '../lib/goals';
import { useTheme } from '../design/theme';
import type { ShellContext } from '../components/Shell';

const DAY = 864e5;

function readingStats(sessions: ReadingSession[]) {
  const key = (t: number) => new Date(t).toDateString();
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    if (s.deleted_at) continue;
    byDay.set(key(s.started_at), (byDay.get(key(s.started_at)) ?? 0) + s.duration_sec);
  }
  const today = Math.round((byDay.get(key(Date.now())) ?? 0) / 60);
  let week = 0;
  for (let i = 0; i < 7; i++) week += byDay.get(key(Date.now() - i * DAY)) ?? 0;
  let streak = 0;
  const d = new Date();
  if (!byDay.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (byDay.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { today, week: Math.round(week / 60), streak };
}

export default function Home() {
  const navigate = useNavigate();
  const { openImport, openSettings } = useOutletContext<ShellContext>();
  const { setActiveCoverUrl } = useTheme();
  const [showSyncPrompt, setShowSyncPrompt] = useState(false);

  useEffect(() => {
    void (async () => {
      const dismissed = await db.kv.get('dismissed_sync_prompt');
      const user = await getAuthUser();
      if (!user && dismissed?.value !== true) {
        setShowSyncPrompt(true);
      }
    })();
  }, []);

  const handleDismissPrompt = async () => {
    setShowSyncPrompt(false);
    await db.kv.put({ key: 'dismissed_sync_prompt', value: true });
  };

  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[]);
  const progressRows = useLiveQuery(() => db.progress.toArray(), [], [] as Progress[]);
  const sessions = useLiveQuery(
    () => db.reading_sessions.where('started_at').above(Date.now() - 60 * DAY).toArray(),
    [],
    [] as ReadingSession[],
  );
  const followedSeries = useLiveQuery(
    () => db.series.filter((s) => !s.deleted_at).toArray(),
    [],
    [],
  );
  const favIds = useFavoriteIds();

  const progress = useMemo(() => new Map(progressRows.map((p) => [p.id, p])), [progressRows]);
  const recent = useMemo(
    () =>
      books
        .filter((b) => b.last_opened_at)
        .sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0))
        .slice(0, 5),
    [books],
  );
  const favorites = useMemo(() => books.filter((b) => favIds.has(b.id)).slice(0, 10), [books, favIds]);
  const added = useMemo(() => [...books].sort((a, b) => b.added_at - a.added_at).slice(0, 12), [books]);
  const stats = useMemo(() => readingStats(sessions), [sessions]);
  const { goals } = useReadingGoals();
  const finishedBooksCount = useMemo(
    () => books.filter((b) => !!b.meta?.finished_at).length,
    [books],
  );
  const dailyGoalPercent = Math.min(
    100,
    Math.round((stats.today / Math.max(1, goals.dailyMinutes)) * 100),
  );

  const hero = recent[0];
  const heroCoverUrl = useCoverBlobUrl(hero?.id ?? '', hero?.cover_hash ?? null);

  useEffect(() => {
    if (heroCoverUrl) {
      setActiveCoverUrl(heroCoverUrl);
    } else {
      setActiveCoverUrl(null);
    }
  }, [heroCoverUrl, setActiveCoverUrl]);

  const open = (b: Book) => navigate(`/read/${b.id}`);
  const pct = (b: Book) => Math.round((progress.get(b.id)?.percent ?? 0) * 100);

  if (!books.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-xl mx-auto w-full gap-6">
        {showSyncPrompt && (
          <div className="w-full p-4 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in-0 duration-200">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm text-[var(--text-1)]">Sync across devices?</div>
                <div className="text-xs text-[var(--text-2)] mt-0.5">
                  Folio lets you sync books, notes, and reading progress across all your devices.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <Button size="sm" variant="subtle" onClick={handleDismissPrompt}>
                Not now
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => {
                  void handleDismissPrompt();
                  openSettings?.('account');
                }}
              >
                Sign in
              </Button>
            </div>
          </div>
        )}
        <EmptyState
          icon={<BookOpen className="w-8 h-8" />}
          title="Welcome to Folio"
          description="Add EPUB, MOBI, AZW3, FB2, CBZ or PDF files to get started. You can also drag & drop them directly into this window."
          action={
            <Button variant="accent" size="lg" icon={<Plus className="w-4 h-4" />} onClick={openImport}>
              Add Books
            </Button>
          }
        />
      </div>
    );
  }

  const getContextSections = (b: Book) => {
    const fav = favIds.has(b.id);
    return [
      {
        items: [
          {
            key: 'open',
            label: 'Open reader',
            icon: <BookOpen className="w-4 h-4" />,
            onSelect: () => open(b),
          },
          {
            key: 'fav',
            label: fav ? 'Remove favourite' : 'Add favourite',
            icon: <Heart className="w-4 h-4" />,
            onSelect: () => void toggleFavorite(b.id),
          },
          {
            key: 'finish',
            label: pct(b) >= 99 ? 'Mark unread' : 'Mark finished',
            icon: <CheckCircle className="w-4 h-4" />,
            onSelect: async () => {
              const newPercent = pct(b) >= 99 ? 0 : 1;
              await db.progress.put({
                id: b.id,
                cfi: '',
                percent: newPercent,
                chapter: null,
                device_id: deviceId(),
                deleted_at: null,
                ...dirty(),
              });
            },
          },
        ],
      },
    ];
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-8 max-w-7xl mx-auto w-full">
      {/* First-run sync prompt */}
      {showSyncPrompt && (
        <div className="p-4 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in-0 duration-200">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sm text-[var(--text-1)]">Sync across devices?</div>
              <div className="text-xs text-[var(--text-2)] mt-0.5">
                Folio lets you sync books, notes, and reading progress across all your devices.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <Button size="sm" variant="subtle" onClick={handleDismissPrompt}>
              Not now
            </Button>
            <Button
              size="sm"
              variant="accent"
              onClick={() => {
                void handleDismissPrompt();
                openSettings?.('account');
              }}
            >
              Sign in
            </Button>
          </div>
        </div>
      )}
      {/* Top Split: Recent Reads & Hero + Stats Chips */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left / Hero Column */}
        <section className="lg:col-span-7 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Recent reads</h2>
            <Link
              to="/library"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              Open library <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {hero ? (
            <div className="flex flex-col sm:flex-row gap-6 p-5 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-sm backdrop-blur-md">
              {/* Hero Cover (300px wide on desktop) */}
              <div className="w-full sm:w-[220px] md:w-[260px] lg:w-[280px] shrink-0">
                <ContextMenu sections={getContextSections(hero)}>
                  <div>
                    <BookCover
                      id={hero.id}
                      title={hero.title}
                      author={hero.author}
                      coverHash={hero.cover_hash}
                      progressPercent={pct(hero)}
                      isFavourite={favIds.has(hero.id)}
                      onToggleFavourite={() => void toggleFavorite(hero.id)}
                      onClick={() => open(hero)}
                    />
                  </div>
                </ContextMenu>
              </div>

              {/* Hero Metadata & Resume */}
              <div className="flex flex-col justify-between grow py-1 gap-4">
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
                    Continue reading
                  </span>
                  <h3 className="font-display text-2xl font-bold text-[var(--text-1)] leading-tight line-clamp-2">
                    {hero.title}
                  </h3>
                  <p className="text-sm text-[var(--text-2)] font-medium line-clamp-1">
                    {hero.author}
                  </p>
                  {progress.get(hero.id)?.chapter && (
                    <p className="text-xs text-[var(--text-3)] line-clamp-1 italic">
                      {progress.get(hero.id)?.chapter}
                    </p>
                  )}
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between text-xs text-[var(--text-2)] font-medium">
                    <span>{pct(hero)}% completed</span>
                  </div>
                  <div className="w-full h-1.5 bg-[var(--layer-3)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] rounded-full transition-all duration-[var(--d-fast)]"
                      style={{ width: `${pct(hero)}%` }}
                    />
                  </div>

                  <div className="pt-1">
                    <Button
                      variant="accent"
                      size="md"
                      icon={<Play className="w-4 h-4 fill-current" />}
                      onClick={() => open(hero)}
                    >
                      Resume
                    </Button>
                  </div>
                </div>

                {/* Additional Recent Mini-Covers */}
                {recent.length > 1 && (
                  <div className="flex items-center gap-3 pt-3 border-t border-[var(--stroke)]">
                    <span className="text-xs text-[var(--text-3)]">More recent:</span>
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                      {recent.slice(1, 4).map((b) => (
                        <div key={b.id} className="w-11 shrink-0">
                          <BookCover
                            id={b.id}
                            title={b.title}
                            author={b.author}
                            coverHash={b.cover_hash}
                            progressPercent={pct(b)}
                            onClick={() => open(b)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] text-center text-sm text-[var(--text-2)]">
              Open any book to resume reading here.
            </div>
          )}
        </section>

        {/* Right / Stats & Mini Column */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          {/* Reading Goals Progress Card */}
          <Link
            to="/stats"
            className="flex items-center justify-between p-4 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs hover:border-[var(--stroke-strong)] transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3.5">
              <CircularProgress
                value={dailyGoalPercent}
                size={48}
                strokeWidth={5}
                indicatorColor="var(--accent)"
              >
                <span className="text-[11px] font-bold text-[var(--text-1)]">{dailyGoalPercent}%</span>
              </CircularProgress>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
                  Today's Reading Goal
                </span>
                <p className="text-sm font-semibold text-[var(--text-1)] mt-0.5">
                  {stats.today} / {goals.dailyMinutes} min read
                </p>
                <p className="text-[11px] text-[var(--text-3)]">
                  {finishedBooksCount} of {goals.yearlyBooks} books this year
                </p>
              </div>
            </div>
            <div className="flex items-center text-xs text-[var(--text-3)] group-hover:text-[var(--text-1)] transition-colors">
              <span>View stats</span>
              <ChevronRight className="w-4 h-4 ml-0.5" />
            </div>
          </Link>

          {/* Stats Chips */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col items-center justify-center p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <Clock className="w-4 h-4 text-[var(--accent)] mb-1" />
              <span className="text-base font-bold text-[var(--text-1)]">{stats.today}m</span>
              <span className="text-[11px] text-[var(--text-3)] font-medium">Today</span>
            </div>
            <div className="flex flex-col items-center justify-center p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <CalendarDays className="w-4 h-4 text-[var(--accent)] mb-1" />
              <span className="text-base font-bold text-[var(--text-1)]">{stats.week}m</span>
              <span className="text-[11px] text-[var(--text-3)] font-medium">This week</span>
            </div>
            <div className="flex flex-col items-center justify-center p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <Flame className="w-4 h-4 text-[var(--warning)] mb-1" />
              <span className="text-base font-bold text-[var(--text-1)]">
                {stats.streak} {stats.streak === 1 ? 'day' : 'days'}
              </span>
              <span className="text-[11px] text-[var(--text-3)] font-medium">Streak</span>
            </div>
          </div>

          {/* Shelves on Right Column */}
          <div className="space-y-6">
            <Shelf
              title="Favourite books"
              action={
                <Link
                  to="/library?filter=favorites"
                  className="inline-flex items-center gap-1 hover:underline text-xs"
                >
                  See more <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              }
            >
              {favorites.length ? (
                favorites.map((b) => (
                  <ContextMenu key={b.id} sections={getContextSections(b)}>
                    <div className="w-[120px] shrink-0">
                      <BookCard
                        id={b.id}
                        title={b.title}
                        author={b.author}
                        coverHash={b.cover_hash}
                        progressPercent={pct(b)}
                        isFavourite={true}
                        onToggleFavourite={() => void toggleFavorite(b.id)}
                        onClick={() => open(b)}
                      />
                    </div>
                  </ContextMenu>
                ))
              ) : (
                <div className="text-xs text-[var(--text-3)] p-4">
                  Tap the heart on any book to pin it to your favorites.
                </div>
              )}
            </Shelf>
          </div>
        </section>
      </div>

      {/* Full-width Recently Added Shelf */}
      <section className="pt-4 border-t border-[var(--stroke)]">
        <Shelf
          title="Recently added"
          action={
            <Link
              to="/library?sort=added"
              className="inline-flex items-center gap-1 hover:underline text-xs"
            >
              See more <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {added.map((b) => (
            <ContextMenu key={b.id} sections={getContextSections(b)}>
              <div className="w-[130px] shrink-0">
                <BookCard
                  id={b.id}
                  title={b.title}
                  author={b.author}
                  coverHash={b.cover_hash}
                  progressPercent={pct(b)}
                  isFavourite={favIds.has(b.id)}
                  onToggleFavourite={() => void toggleFavorite(b.id)}
                  onClick={() => open(b)}
                />
              </div>
            </ContextMenu>
          ))}
        </Shelf>
      </section>

      {/* Continue Manga Shelf */}
      {followedSeries && followedSeries.length > 0 && (
        <section className="pt-4 border-t border-[var(--stroke)]">
          <Shelf
            title="Continue manga"
            action={
              <Link
                to="/library"
                className="inline-flex items-center gap-1 hover:underline text-xs"
              >
                Manga library <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            }
          >
            {followedSeries.map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(`/series/${encodeURIComponent(s.id)}`)}
                className="w-[130px] shrink-0 cursor-pointer"
              >
                <BookCard
                  id={s.id}
                  title={s.title}
                  author={s.author || 'Unknown'}
                  coverUrl={s.cover_url}
                  onClick={() => navigate(`/series/${encodeURIComponent(s.id)}`)}
                />
              </div>
            ))}
          </Shelf>
        </section>
      )}
    </div>
  );
}