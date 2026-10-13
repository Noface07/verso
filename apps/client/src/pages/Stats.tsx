import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart2,
  Calendar,
  Clock,
  Download,
  Flame,
  Moon,
  Sun,
  Sunrise,
  Sunset,
  Target,
  Trophy,
  Zap,
  BookOpen,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { db, type Book, type Series, type ReadingSession } from '../db';
import {
  computeReadingStats,
  exportSessionsToCsv,
  downloadCsvFile,
  type StatPeriod,
  type DailyBarItem,
  type HeatmapDay,
} from '../lib/stats-engine';
import { useReadingGoals } from '../lib/goals';
import { Tabs, TabsContent, type TabItem } from '../design/components/Tabs';
import { Button } from '../design/components/Button';
import { Dialog } from '../design/components/Dialog';
import { BookCover } from '../design/components/BookCover';
import { CircularProgress } from '../design/components/Progress';

const PERIOD_TABS: TabItem<StatPeriod>[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
];

export default function Stats() {
  const [period, setPeriod] = useState<StatPeriod>('week');
  const [showGoalsDialog, setShowGoalsDialog] = useState(false);
  const [hoveredBar, setHoveredBar] = useState<DailyBarItem | null>(null);
  const [hoveredHeatmap, setHoveredHeatmap] = useState<HeatmapDay | null>(null);

  // Queries
  const sessions = useLiveQuery(() => db.reading_sessions.toArray(), [], [] as ReadingSession[]);
  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[]);
  const series = useLiveQuery(() => db.series.filter((s) => !s.deleted_at).toArray(), [], [] as Series[]);

  const { goals, updateGoals } = useReadingGoals();
  const [editDaily, setEditDaily] = useState<number>(goals.dailyMinutes);
  const [editYearly, setEditYearly] = useState<number>(goals.yearlyBooks);

  // Compute finished books
  const finishedBooks = useMemo(() => {
    return books.filter((b) => !!b.meta?.finished_at);
  }, [books]);

  const finishedBookIds = useMemo(() => {
    return new Set(finishedBooks.map((b) => b.id));
  }, [finishedBooks]);

  // Compute reading statistics
  const stats = useMemo(() => {
    return computeReadingStats(sessions, period, {
      books,
      series,
      finishedBookIds,
    });
  }, [sessions, period, books, series, finishedBookIds]);

  // Compute today's minutes for daily goal
  const todayStats = useMemo(() => {
    return computeReadingStats(sessions, 'week', { books, series });
  }, [sessions, books, series]);

  const todayMinutes = useMemo(() => {
    const todayBar = todayStats.dailyBarChart[todayStats.dailyBarChart.length - 1];
    return todayBar?.totalMinutes ?? 0;
  }, [todayStats]);

  const dailyGoalPercent = Math.min(100, Math.round((todayMinutes / Math.max(1, goals.dailyMinutes)) * 100));
  const yearlyGoalPercent = Math.min(
    100,
    Math.round((finishedBooks.length / Math.max(1, goals.yearlyBooks)) * 100),
  );

  // CSV export handler
  const handleExportCsv = () => {
    const booksMap = new Map(books.map((b) => [b.id, b]));
    const seriesMap = new Map(series.map((s) => [s.id, s]));
    const csv = exportSessionsToCsv(sessions, booksMap, seriesMap);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCsvFile(csv, `folio-reading-sessions-${dateStr}.csv`);
  };

  const handleSaveGoals = async () => {
    await updateGoals({ dailyMinutes: editDaily, yearlyBooks: editYearly });
    setShowGoalsDialog(false);
  };

  // Bar chart max height scale
  const maxBarMinutes = useMemo(() => {
    const max = Math.max(...stats.dailyBarChart.map((b) => b.totalMinutes), 1);
    return Math.ceil(max / 15) * 15 || 60;
  }, [stats.dailyBarChart]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 select-none">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text-1)]">
            Reading Statistics
          </h1>
          <p className="text-sm text-[var(--text-2)] mt-0.5">
            Your reading habits, pace, streaks, and personal milestones
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="standard"
            size="sm"
            icon={<Sliders className="w-4 h-4" />}
            onClick={() => {
              setEditDaily(goals.dailyMinutes);
              setEditYearly(goals.yearlyBooks);
              setShowGoalsDialog(true);
            }}
          >
            Goals
          </Button>

          <Button
            variant="standard"
            size="sm"
            icon={<Download className="w-4 h-4" />}
            onClick={handleExportCsv}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* Reading Goals Overview Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Goal Card */}
        <div className="flex items-center gap-4 p-4 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
          <CircularProgress
            value={dailyGoalPercent}
            size={56}
            strokeWidth={5}
            indicatorColor="var(--accent)"
          >
            <span className="text-xs font-bold text-[var(--text-1)]">{dailyGoalPercent}%</span>
          </CircularProgress>
          <div className="grow min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5" /> Daily Goal
              </span>
              <span className="text-xs text-[var(--text-3)] font-medium">
                {todayMinutes} / {goals.dailyMinutes} min
              </span>
            </div>
            <p className="text-sm font-semibold text-[var(--text-1)] mt-1 truncate">
              {todayMinutes >= goals.dailyMinutes
                ? 'Goal achieved today! 🎉'
                : `${goals.dailyMinutes - todayMinutes} minutes left today`}
            </p>
          </div>
        </div>

        {/* Yearly Goal Card */}
        <div className="flex items-center gap-4 p-4 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
          <CircularProgress
            value={yearlyGoalPercent}
            size={56}
            strokeWidth={5}
            indicatorColor="var(--success)"
          >
            <span className="text-xs font-bold text-[var(--text-1)]">{yearlyGoalPercent}%</span>
          </CircularProgress>
          <div className="grow min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--success)] flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5" /> Yearly Books Goal
              </span>
              <span className="text-xs text-[var(--text-3)] font-medium">
                {finishedBooks.length} / {goals.yearlyBooks} books
              </span>
            </div>
            <p className="text-sm font-semibold text-[var(--text-1)] mt-1 truncate">
              {finishedBooks.length >= goals.yearlyBooks
                ? 'Yearly reading target reached! 🏆'
                : `${goals.yearlyBooks - finishedBooks.length} books remaining this year`}
            </p>
          </div>
        </div>
      </div>

      {/* Period Tabs */}
      <Tabs
        items={PERIOD_TABS}
        value={period}
        onValueChange={(val) => setPeriod(val)}
        className="w-full"
      >
        <TabsContent value={period} className="space-y-6 pt-4">
          {/* Key Metric Highlights Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Total Time */}
            <div className="p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center gap-1.5 text-[var(--accent)] text-xs font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>Reading Time</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mt-1.5">
                {stats.totalDurationFormatted}
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">Total duration</div>
            </div>

            {/* Daily Average */}
            <div className="p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center gap-1.5 text-[var(--accent)] text-xs font-medium">
                <Calendar className="w-3.5 h-3.5" />
                <span>Daily Average</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mt-1.5">
                {stats.dailyAverageMinutes}m
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">Per day in period</div>
            </div>

            {/* Longest Session */}
            <div className="p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center gap-1.5 text-[var(--accent)] text-xs font-medium">
                <Zap className="w-3.5 h-3.5" />
                <span>Longest Session</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mt-1.5">
                {stats.longestSessionFormatted}
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">Single session max</div>
            </div>

            {/* Reading Speed */}
            <div className="p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center gap-1.5 text-[var(--accent)] text-xs font-medium">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Reading Speed</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mt-1.5">
                {stats.bookSpeedWpm > 0 ? `${stats.bookSpeedWpm} wpm` : '—'}
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                {stats.mangaSpeedPpm > 0 ? `${stats.mangaSpeedPpm} manga ppm` : 'Words / minute'}
              </div>
            </div>

            {/* Streaks */}
            <div className="p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center gap-1.5 text-[var(--warning)] text-xs font-medium">
                <Flame className="w-3.5 h-3.5" />
                <span>Reading Streak</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mt-1.5">
                {stats.currentStreak} {stats.currentStreak === 1 ? 'day' : 'days'}
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                Best: {stats.longestStreak} days
              </div>
            </div>

            {/* Books & Chapters Finished */}
            <div className="p-3.5 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center gap-1.5 text-[var(--success)] text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Finished</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mt-1.5">
                {stats.booksFinishedCount} books
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                {stats.chaptersReadCount} manga chapters
              </div>
            </div>
          </div>

          {/* Daily Reading Bar Chart */}
          <div className="p-5 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-[var(--text-1)] flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-[var(--accent)]" />
                  Daily Reading Time
                </h3>
                <p className="text-xs text-[var(--text-3)] mt-0.5">
                  Minutes read each day across books and manga
                </p>
              </div>

              {hoveredBar && (
                <div className="text-xs font-medium px-2.5 py-1 rounded-[var(--r-md)] bg-[var(--layer-3)] border border-[var(--stroke)] text-[var(--text-1)]">
                  <span className="font-bold text-[var(--accent)]">{hoveredBar.totalMinutes} min</span> on{' '}
                  {hoveredBar.date}
                  {hoveredBar.mangaMinutes > 0 && (
                    <span className="text-[var(--text-3)] ml-1">
                      ({hoveredBar.bookMinutes}m books, {hoveredBar.mangaMinutes}m manga)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Responsive SVG Bar Chart */}
            <div className="w-full h-48 sm:h-56 relative flex items-end justify-between gap-1 pt-6 pb-6 px-1">
              {/* Horizontal Reference Lines */}
              <div className="absolute inset-0 top-6 bottom-6 flex flex-col justify-between pointer-events-none opacity-20">
                <div className="border-b border-[var(--stroke)] w-full" />
                <div className="border-b border-[var(--stroke)] w-full" />
                <div className="border-b border-[var(--stroke)] w-full" />
              </div>

              {stats.dailyBarChart.map((bar) => {
                const heightPct = Math.min(100, Math.round((bar.totalMinutes / maxBarMinutes) * 100));
                const isHovered = hoveredBar?.date === bar.date;

                return (
                  <div
                    key={bar.date}
                    className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer relative"
                    onMouseEnter={() => setHoveredBar(bar)}
                    onMouseLeave={() => setHoveredBar(null)}
                  >
                    {/* Bar Pill */}
                    <div className="w-full max-w-[32px] flex flex-col justify-end h-full">
                      <div
                        className={`w-full rounded-t-md transition-all duration-200 ${
                          isHovered
                            ? 'bg-[var(--accent-hover)] shadow-sm'
                            : bar.totalMinutes > 0
                              ? 'bg-[var(--accent)]'
                              : 'bg-[var(--layer-3)]'
                        }`}
                        style={{
                          height: `${Math.max(4, heightPct)}%`,
                        }}
                      />
                    </div>

                    {/* X-axis Label */}
                    <span
                      className={`text-[10px] mt-2 truncate transition-colors ${
                        isHovered ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-3)]'
                      }`}
                    >
                      {bar.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* GitHub-style Calendar Heatmap */}
          <div className="p-5 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base font-bold text-[var(--text-1)] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[var(--accent)]" />
                  Reading Activity Heatmap
                </h3>
                <p className="text-xs text-[var(--text-3)] mt-0.5">
                  Consistent reading across the past 52 weeks ({stats.currentStreak}-day streak)
                </p>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
                <span>Less</span>
                <div className="w-3 h-3 rounded-xs bg-[var(--layer-3)]" />
                <div className="w-3 h-3 rounded-xs bg-[var(--accent-soft)]" />
                <div className="w-3 h-3 rounded-xs bg-[var(--accent)] opacity-60" />
                <div className="w-3 h-3 rounded-xs bg-[var(--accent)] opacity-80" />
                <div className="w-3 h-3 rounded-xs bg-[var(--accent)]" />
                <span>More</span>
              </div>
            </div>

            {/* Heatmap Grid */}
            <div className="overflow-x-auto pb-2 no-scrollbar">
              <div className="inline-grid grid-rows-7 grid-flow-col gap-1 min-w-[700px]">
                {stats.heatmap.map((day) => {
                  let bgStyle = 'bg-[var(--layer-3)]';
                  if (day.level === 1) bgStyle = 'bg-[var(--accent-soft)]';
                  if (day.level === 2) bgStyle = 'bg-[var(--accent)] opacity-60';
                  if (day.level === 3) bgStyle = 'bg-[var(--accent)] opacity-80';
                  if (day.level === 4) bgStyle = 'bg-[var(--accent)]';

                  return (
                    <div
                      key={day.date}
                      className={`w-3 h-3 rounded-xs cursor-pointer transition-all hover:ring-2 hover:ring-[var(--accent)] ${bgStyle}`}
                      title={`${day.date}: ${day.minutes} minutes`}
                      onMouseEnter={() => setHoveredHeatmap(day)}
                      onMouseLeave={() => setHoveredHeatmap(null)}
                    />
                  );
                })}
              </div>
            </div>

            {hoveredHeatmap && (
              <div className="text-xs text-[var(--text-2)] mt-2">
                <span className="font-semibold text-[var(--text-1)]">{hoveredHeatmap.date}</span>: {hoveredHeatmap.minutes} minutes read
              </div>
            )}
          </div>

          {/* Time of Day Distribution & Top Items Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Time of Day Distribution */}
            <div className="p-5 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <h3 className="text-base font-bold text-[var(--text-1)] mb-1">
                Time of Day Distribution
              </h3>
              <p className="text-xs text-[var(--text-3)] mb-4">
                When you prefer to read throughout the day
              </p>

              <div className="space-y-3.5">
                {stats.timeOfDay.map((tod) => {
                  const icon =
                    tod.key === 'morning' ? (
                      <Sunrise className="w-4 h-4 text-[var(--warning)]" />
                    ) : tod.key === 'afternoon' ? (
                      <Sun className="w-4 h-4 text-[var(--warning)]" />
                    ) : tod.key === 'evening' ? (
                      <Sunset className="w-4 h-4 text-[var(--accent)]" />
                    ) : (
                      <Moon className="w-4 h-4 text-[var(--accent)]" />
                    );

                  return (
                    <div key={tod.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--text-1)] flex items-center gap-2">
                          {icon}
                          {tod.label} <span className="text-[var(--text-3)] text-[11px]">({tod.hours})</span>
                        </span>
                        <span className="text-[var(--text-2)] font-semibold">
                          {tod.percentage}% ({Math.round(tod.durationSec / 60)}m)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[var(--layer-3)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                          style={{ width: `${tod.percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Books & Series by Time */}
            <div className="p-5 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--text-1)] mb-1">
                  Top Titles by Reading Time
                </h3>
                <p className="text-xs text-[var(--text-3)] mb-4">
                  Books and manga series you spent the most time reading
                </p>

                {stats.topItems.length > 0 ? (
                  <div className="space-y-3">
                    {stats.topItems.slice(0, 5).map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 text-xs p-2 rounded-[var(--r-md)] bg-[var(--layer-1)] border border-[var(--stroke)]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-bold text-[var(--text-3)] w-4 text-center">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-[var(--text-1)] truncate">
                              {item.title}
                            </p>
                            <p className="text-[11px] text-[var(--text-3)] truncate">
                              {item.kind === 'manga' ? 'Manga Series' : item.authorOrMeta || 'Book'}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="font-bold text-[var(--text-1)]">
                            {Math.round(item.durationSec / 60)}m
                          </span>
                          <div className="text-[10px] text-[var(--accent)] font-medium">
                            {item.percentageOfTotal}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-xs text-[var(--text-3)]">
                    No reading recorded in this period yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Finished Books Wall */}
          {finishedBooks.length > 0 && (
            <div className="p-5 rounded-[var(--r-xl)] bg-[var(--layer-2)] border border-[var(--stroke)] shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-1)] flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-[var(--success)]" />
                    Finished Books Wall
                  </h3>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">
                    {finishedBooks.length} completed books in your personal library
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                {finishedBooks.map((b) => (
                  <div key={b.id} className="flex flex-col items-center text-center group">
                    <div className="w-full aspect-[2/3] max-w-[100px]">
                      <BookCover
                        id={b.id}
                        title={b.title}
                        author={b.author}
                        coverHash={b.cover_hash}
                        progressPercent={100}
                      />
                    </div>
                    <span className="text-xs font-medium text-[var(--text-1)] mt-1.5 line-clamp-1">
                      {b.title}
                    </span>
                    <span className="text-[10px] text-[var(--text-3)] line-clamp-1">
                      {b.author}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Reading Goals Setup / Edit Dialog */}
      {showGoalsDialog && (
        <Dialog
          open={true}
          onOpenChange={(open) => !open && setShowGoalsDialog(false)}
          title="Reading Goals"
          description="Set your daily reading target and yearly book completion milestones."
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="standard" onClick={() => setShowGoalsDialog(false)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={handleSaveGoals}>
                Save Goals
              </Button>
            </div>
          }
        >
          <div className="space-y-4 py-2">
            <div>
              <label
                htmlFor="daily-reading-goal-input"
                className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider block mb-1.5"
              >
                Daily Reading Goal (Minutes)
              </label>
              <input
                id="daily-reading-goal-input"
                type="number"
                min={5}
                max={480}
                value={editDaily}
                onChange={(e) => setEditDaily(Math.max(5, parseInt(e.target.value, 10) || 5))}
                className="w-full px-3 py-2 text-sm rounded-[var(--r-md)] bg-[var(--layer-3)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <p className="text-[11px] text-[var(--text-3)] mt-1">
                Suggested targets: 15, 30, 45, or 60 minutes
              </p>
            </div>

            <div>
              <label
                htmlFor="yearly-reading-goal-input"
                className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider block mb-1.5"
              >
                Yearly Finished Books Goal
              </label>
              <input
                id="yearly-reading-goal-input"
                type="number"
                min={1}
                max={365}
                value={editYearly}
                onChange={(e) => setEditYearly(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-2 text-sm rounded-[var(--r-md)] bg-[var(--layer-3)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <p className="text-[11px] text-[var(--text-3)] mt-1">
                Suggested targets: 12, 20, 30, or 50 books per year
              </p>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
