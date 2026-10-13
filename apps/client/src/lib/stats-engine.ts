import type { ReadingSession, Book, Series } from '../db';

export type StatPeriod = 'week' | 'month' | 'year' | 'all';

export interface DailyBarItem {
  date: string; // 'YYYY-MM-DD'
  label: string; // e.g. 'Mon', '12 Oct'
  totalMinutes: number;
  bookMinutes: number;
  mangaMinutes: number;
}

export interface HeatmapDay {
  date: string; // 'YYYY-MM-DD'
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
}

export interface TimeOfDaySegment {
  key: 'morning' | 'afternoon' | 'evening' | 'night';
  label: string;
  hours: string;
  durationSec: number;
  percentage: number;
}

export interface TopItem {
  id: string;
  title: string;
  authorOrMeta?: string;
  coverHash?: string | null;
  coverUrl?: string | null;
  kind: 'book' | 'manga';
  durationSec: number;
  unitsRead: number; // words for book, chapters/pages for manga
  percentageOfTotal: number;
}

export interface StatsSummary {
  period: StatPeriod;
  totalDurationSec: number;
  totalDurationFormatted: string;
  dailyAverageMinutes: number;
  longestSessionSec: number;
  longestSessionFormatted: string;
  bookSpeedWpm: number;
  mangaSpeedPpm: number;
  booksFinishedCount: number;
  chaptersReadCount: number;
  currentStreak: number;
  longestStreak: number;
  dailyBarChart: DailyBarItem[];
  heatmap: HeatmapDay[];
  timeOfDay: TimeOfDaySegment[];
  topItems: TopItem[];
}

export interface StatsEngineOptions {
  timeZone?: string;
  now?: number;
}

/**
 * Formats a duration in seconds to a human-readable string like "3h 45m" or "42m".
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);

  if (hrs === 0) return `${Math.max(1, mins)}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();
const hourFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dateKeyFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatterCache.set(timeZone, f);
  }
  return f;
}

function getHourFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = hourFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    });
    hourFormatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * Formats a timestamp into YYYY-MM-DD string in a specified time zone.
 */
export function getDateKey(timestampMs: number, timeZone: string = 'Asia/Kolkata'): string {
  try {
    return getDateFormatter(timeZone).format(new Date(timestampMs));
  } catch {
    const d = new Date(timestampMs);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  }
}

/**
 * Gets the hour of the day (0..23) for a timestamp in a specified time zone.
 */
export function getHourInTimezone(timestampMs: number, timeZone: string = 'Asia/Kolkata'): number {
  try {
    const parts = getHourFormatter(timeZone).formatToParts(new Date(timestampMs));
    const hrPart = parts.find((p) => p.type === 'hour');
    return hrPart ? parseInt(hrPart.value, 10) % 24 : new Date(timestampMs).getHours();
  } catch {
    return new Date(timestampMs).getHours();
  }
}

/**
 * Splits a reading session that crosses local midnight into single-day segments.
 */
export interface SplitSessionSegment {
  dateKey: string;
  startHour: number;
  durationSec: number;
  kind: 'book' | 'manga';
  bookId: string;
  wordsRead: number;
}

export function splitSessionByMidnight(
  session: ReadingSession,
  timeZone: string = 'Asia/Kolkata',
): SplitSessionSegment[] {
  if (session.duration_sec <= 0) return [];
  const kind: 'book' | 'manga' = session.kind === 'manga' ? 'manga' : 'book';
  const startKey = getDateKey(session.started_at, timeZone);
  const endKey = getDateKey(session.ended_at, timeZone);

  if (startKey === endKey) {
    return [
      {
        dateKey: startKey,
        startHour: getHourInTimezone(session.started_at, timeZone),
        durationSec: session.duration_sec,
        kind,
        bookId: session.book_id,
        wordsRead: session.words_read || 0,
      },
    ];
  }

  // Crosses midnight: calculate proportion based on midnight boundary
  // Estimate end of start day
  const startDate = new Date(session.started_at);
  const segments: SplitSessionSegment[] = [];

  // Approximate midnight timestamp
  // Let's find milliseconds remaining until next day in target timezone
  const startHour = getHourInTimezone(session.started_at, timeZone);
  const endHour = getHourInTimezone(session.ended_at, timeZone);

  // Time in ms until midnight of start day approx
  // Fraction of session in day 1 vs day 2
  const totalElapsedMs = Math.max(1, session.ended_at - session.started_at);
  // Estimate day 1 portion
  const approxMsToMidnight = (24 - startHour) * 3600 * 1000 - startDate.getMinutes() * 60000;
  const day1Ratio = Math.max(0.05, Math.min(0.95, approxMsToMidnight / totalElapsedMs));

  const day1Sec = Math.round(session.duration_sec * day1Ratio);
  const day2Sec = Math.max(0, session.duration_sec - day1Sec);

  const day1Words = Math.round((session.words_read || 0) * day1Ratio);
  const day2Words = Math.max(0, (session.words_read || 0) - day1Words);

  if (day1Sec > 0) {
    segments.push({
      dateKey: startKey,
      startHour,
      durationSec: day1Sec,
      kind,
      bookId: session.book_id,
      wordsRead: day1Words,
    });
  }
  if (day2Sec > 0) {
    segments.push({
      dateKey: endKey,
      startHour: endHour,
      durationSec: day2Sec,
      kind,
      bookId: session.book_id,
      wordsRead: day2Words,
    });
  }

  return segments;
}

/**
 * Calculates streaks (current streak and longest streak) across all session dates.
 */
export function calculateStreaks(
  dateKeysWithReading: Set<string>,
  referenceDateKey: string,
): { currentStreak: number; longestStreak: number } {
  if (dateKeysWithReading.size === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Helper to add/sub days from YYYY-MM-DD
  const shiftDay = (dateStr: string, offsetDays: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + offsetDays);
    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(date.getUTCDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  };

  // Calculate current streak
  let currentStreak = 0;
  let checkKey = referenceDateKey;

  // If user hasn't read today, check if yesterday was read to keep streak alive
  if (!dateKeysWithReading.has(checkKey)) {
    checkKey = shiftDay(checkKey, -1);
  }

  while (dateKeysWithReading.has(checkKey)) {
    currentStreak++;
    checkKey = shiftDay(checkKey, -1);
  }

  // Calculate longest streak across sorted list of all active days
  const sortedDays = Array.from(dateKeysWithReading).sort();
  let longestStreak = 0;
  let currentStreakCount = 0;
  let prevDay: string | null = null;

  for (const day of sortedDays) {
    if (!prevDay) {
      currentStreakCount = 1;
    } else {
      const expectedNext = shiftDay(prevDay, 1);
      if (day === expectedNext) {
        currentStreakCount++;
      } else {
        currentStreakCount = 1;
      }
    }
    prevDay = day;
    if (currentStreakCount > longestStreak) {
      longestStreak = currentStreakCount;
    }
  }

  return { currentStreak, longestStreak };
}

/**
 * Main statistics computation engine.
 */
export function computeReadingStats(
  sessions: ReadingSession[],
  period: StatPeriod = 'week',
  options?: StatsEngineOptions & {
    books?: Book[];
    series?: Series[];
    finishedBookIds?: Set<string>;
  },
): StatsSummary {
  const timeZone = options?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const nowMs = options?.now || Date.now();
  const todayKey = getDateKey(nowMs, timeZone);

  const booksMap = new Map<string, Book>();
  if (options?.books) {
    for (const b of options.books) booksMap.set(b.id, b);
  }

  const seriesMap = new Map<string, Series>();
  if (options?.series) {
    for (const s of options.series) seriesMap.set(s.id, s);
  }

  // 1. Filter out deleted sessions and find bounds
  const validSessions = sessions.filter((s) => !s.deleted_at && s.duration_sec >= 20);

  // 2. Determine date filter range based on period
  const DAY_MS = 864e5;
  let minTimestamp: number;
  let numPeriodDays: number;

  if (period === 'week') {
    numPeriodDays = 7;
    minTimestamp = nowMs - 7 * DAY_MS;
  } else if (period === 'month') {
    numPeriodDays = 30;
    minTimestamp = nowMs - 30 * DAY_MS;
  } else if (period === 'year') {
    numPeriodDays = 365;
    minTimestamp = nowMs - 365 * DAY_MS;
  } else {
    // 'all'
    minTimestamp = 0;
    numPeriodDays = 365;
  }

  // 3. Process sessions: all-time for streak & heatmap, filtered for period summary
  const allTimeActiveDays = new Set<string>();
  const allTimeHeatmapMap = new Map<string, number>(); // YYYY-MM-DD -> total minutes

  let totalDurationSec = 0;
  let longestSessionSec = 0;
  let totalBookSec = 0;
  let totalBookWords = 0;
  let totalMangaSec = 0;
  let totalMangaPages = 0;

  const itemDurationMap = new Map<string, { durationSec: number; units: number; kind: 'book' | 'manga' }>();
  const periodDailyMap = new Map<string, { bookSec: number; mangaSec: number }>();
  const timeOfDayBuckets: Record<'morning' | 'afternoon' | 'evening' | 'night', number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };

  for (const session of validSessions) {
    // Track active day for streak
    const sessionDateKey = getDateKey(session.started_at, timeZone);
    allTimeActiveDays.add(sessionDateKey);

    // Heatmap tracking (last 365 days)
    const sessionMinutes = session.duration_sec / 60;
    allTimeHeatmapMap.set(sessionDateKey, (allTimeHeatmapMap.get(sessionDateKey) ?? 0) + sessionMinutes);

    // Filter for current period
    if (session.started_at >= minTimestamp) {
      totalDurationSec += session.duration_sec;
      if (session.duration_sec > longestSessionSec) {
        longestSessionSec = session.duration_sec;
      }

      // Midnight splitting for accurate daily breakdown & time-of-day
      const splitSegments = splitSessionByMidnight(session, timeZone);
      for (const seg of splitSegments) {
        // Daily chart data
        const currentDaily = periodDailyMap.get(seg.dateKey) ?? { bookSec: 0, mangaSec: 0 };
        if (seg.kind === 'manga') {
          currentDaily.mangaSec += seg.durationSec;
        } else {
          currentDaily.bookSec += seg.durationSec;
        }
        periodDailyMap.set(seg.dateKey, currentDaily);

        // Time of day bucket
        const hr = seg.startHour;
        if (hr >= 6 && hr < 12) {
          timeOfDayBuckets.morning += seg.durationSec;
        } else if (hr >= 12 && hr < 17) {
          timeOfDayBuckets.afternoon += seg.durationSec;
        } else if (hr >= 17 && hr < 22) {
          timeOfDayBuckets.evening += seg.durationSec;
        } else {
          timeOfDayBuckets.night += seg.durationSec;
        }
      }

      // Aggregate reading speeds
      if (session.kind === 'manga') {
        totalMangaSec += session.duration_sec;
        totalMangaPages += session.words_read || 0;
      } else {
        totalBookSec += session.duration_sec;
        totalBookWords += session.words_read || 0;
      }

      // Top items
      const sessionKind: 'book' | 'manga' = session.kind === 'manga' ? 'manga' : 'book';
      const existingItem = itemDurationMap.get(session.book_id) ?? {
        durationSec: 0,
        units: 0,
        kind: sessionKind,
      };
      existingItem.durationSec += session.duration_sec;
      existingItem.units += session.words_read || 0;
      existingItem.kind = sessionKind;
      itemDurationMap.set(session.book_id, existingItem);
    }
  }

  // 4. Calculate streaks
  const { currentStreak, longestStreak } = calculateStreaks(allTimeActiveDays, todayKey);

  // 5. Build Daily Bar Chart items
  const dailyBarChart: DailyBarItem[] = [];
  const shiftDateKey = (baseDateKey: string, offset: number): string => {
    const [y, m, d] = baseDateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + offset);
    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(date.getUTCDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  };

  const dayLabelFormatter = (dKey: string): string => {
    const [y, m, d] = dKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (period === 'week') {
      return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    }
    return `${dt.getUTCDate()} ${dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
  };

  const chartDaysCount = period === 'week' ? 7 : period === 'month' ? 30 : 14;
  for (let i = chartDaysCount - 1; i >= 0; i--) {
    const dKey = shiftDateKey(todayKey, -i);
    const entry = periodDailyMap.get(dKey) ?? { bookSec: 0, mangaSec: 0 };
    const bMin = Math.round(entry.bookSec / 60);
    const mMin = Math.round(entry.mangaSec / 60);
    dailyBarChart.push({
      date: dKey,
      label: dayLabelFormatter(dKey),
      totalMinutes: bMin + mMin,
      bookMinutes: bMin,
      mangaMinutes: mMin,
    });
  }

  // 6. Build Calendar Heatmap (past 364 days, 52 weeks of 7 days)
  const heatmap: HeatmapDay[] = [];
  const totalHeatmapDays = 52 * 7;
  for (let i = totalHeatmapDays - 1; i >= 0; i--) {
    const dKey = shiftDateKey(todayKey, -i);
    const [y, m, d] = dKey.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = dt.getUTCDay(); // 0 = Sun, 1 = Mon ...
    const minutes = Math.round(allTimeHeatmapMap.get(dKey) ?? 0);

    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (minutes > 60) level = 4;
    else if (minutes >= 30) level = 3;
    else if (minutes >= 15) level = 2;
    else if (minutes > 0) level = 1;

    heatmap.push({
      date: dKey,
      minutes,
      level,
      dayOfWeek,
    });
  }

  // 7. Time of day distribution
  const totalTodSec = Math.max(
    1,
    timeOfDayBuckets.morning + timeOfDayBuckets.afternoon + timeOfDayBuckets.evening + timeOfDayBuckets.night,
  );
  const timeOfDay: TimeOfDaySegment[] = [
    {
      key: 'morning',
      label: 'Morning',
      hours: '06:00 – 12:00',
      durationSec: timeOfDayBuckets.morning,
      percentage: Math.round((timeOfDayBuckets.morning / totalTodSec) * 100),
    },
    {
      key: 'afternoon',
      label: 'Afternoon',
      hours: '12:00 – 17:00',
      durationSec: timeOfDayBuckets.afternoon,
      percentage: Math.round((timeOfDayBuckets.afternoon / totalTodSec) * 100),
    },
    {
      key: 'evening',
      label: 'Evening',
      hours: '17:00 – 22:00',
      durationSec: timeOfDayBuckets.evening,
      percentage: Math.round((timeOfDayBuckets.evening / totalTodSec) * 100),
    },
    {
      key: 'night',
      label: 'Night',
      hours: '22:00 – 06:00',
      durationSec: timeOfDayBuckets.night,
      percentage: Math.round((timeOfDayBuckets.night / totalTodSec) * 100),
    },
  ];

  // 8. Reading speeds
  const bookSpeedWpm = totalBookSec > 0 ? Math.round((totalBookWords / totalBookSec) * 60) : 0;
  const mangaSpeedPpm = totalMangaSec > 0 ? Number(((totalMangaPages / totalMangaSec) * 60).toFixed(1)) : 0;

  // 9. Top Items
  const topItems: TopItem[] = Array.from(itemDurationMap.entries())
    .map(([id, info]) => {
      const book = booksMap.get(id);
      const series = seriesMap.get(id);
      const title = book?.title || series?.title || id;
      const authorOrMeta = book?.author || series?.author || '';
      const coverHash = book?.cover_hash || null;
      const coverUrl = series?.cover_url || null;
      const percentageOfTotal =
        totalDurationSec > 0 ? Math.round((info.durationSec / totalDurationSec) * 100) : 0;

      return {
        id,
        title,
        authorOrMeta,
        coverHash,
        coverUrl,
        kind: info.kind,
        durationSec: info.durationSec,
        unitsRead: info.units,
        percentageOfTotal,
      };
    })
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, 10);

  // 10. Summary numbers
  const dailyAverageMinutes = Math.round(totalDurationSec / Math.max(1, numPeriodDays) / 60);

  // Books finished
  let booksFinishedCount = 0;
  if (options?.finishedBookIds) {
    booksFinishedCount = options.finishedBookIds.size;
  } else if (options?.books) {
    booksFinishedCount = options.books.filter((b) => !!b.meta?.finished_at && !b.deleted_at).length;
  }

  // Chapters read
  let chaptersReadCount = 0;
  for (const session of validSessions) {
    if (session.kind === 'manga' && session.started_at >= minTimestamp) {
      chaptersReadCount += session.words_read > 0 ? 1 : 0;
    }
  }

  return {
    period,
    totalDurationSec,
    totalDurationFormatted: formatDuration(totalDurationSec),
    dailyAverageMinutes,
    longestSessionSec,
    longestSessionFormatted: formatDuration(longestSessionSec),
    bookSpeedWpm,
    mangaSpeedPpm,
    booksFinishedCount,
    chaptersReadCount,
    currentStreak,
    longestStreak,
    dailyBarChart,
    heatmap,
    timeOfDay,
    topItems,
  };
}

/**
 * Generates RFC 4180 compliant CSV string for export.
 */
export function exportSessionsToCsv(
  sessions: ReadingSession[],
  booksMap: Map<string, Book>,
  seriesMap: Map<string, Series>,
  timeZone: string = 'Asia/Kolkata',
): string {
  const headers = [
    'Session ID',
    'Item ID',
    'Title',
    'Kind',
    'Started At',
    'Ended At',
    'Duration (min)',
    'Duration (sec)',
    'Start %',
    'End %',
    'Words/Pages Read',
    'Device ID',
  ];

  const escapeField = (val: string | number | undefined | null): string => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows: string[] = [headers.join(',')];

  const formatDate = (ts: number): string => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toISOString();
    }
  };

  for (const s of sessions) {
    if (s.deleted_at) continue;
    const title =
      s.kind === 'manga'
        ? seriesMap.get(s.book_id)?.title || s.book_id
        : booksMap.get(s.book_id)?.title || s.book_id;

    const row = [
      escapeField(s.id),
      escapeField(s.book_id),
      escapeField(title),
      escapeField(s.kind || 'book'),
      escapeField(formatDate(s.started_at)),
      escapeField(formatDate(s.ended_at)),
      escapeField((s.duration_sec / 60).toFixed(1)),
      escapeField(s.duration_sec),
      escapeField(Math.round(s.start_percent * 100)),
      escapeField(Math.round(s.end_percent * 100)),
      escapeField(s.words_read),
      escapeField(s.device_id),
    ];
    rows.push(row.join(','));
  }

  return rows.join('\r\n');
}

/**
 * Triggers a file download in the browser.
 */
export function downloadCsvFile(content: string, filename: string = 'folio-stats.csv') {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
