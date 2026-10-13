import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, uid, type ReadingSession, type Book, type Series } from '../src/db';
import {
  computeReadingStats,
  splitSessionByMidnight,
  formatDuration,
  exportSessionsToCsv,
} from '../src/lib/stats-engine';
import { getReadingGoals, setReadingGoals, DEFAULT_GOALS } from '../src/lib/goals';
import { IDLE_TIMEOUT_MS, MIN_SESSION_DURATION_SEC } from '../src/lib/session';

describe('Phase 8 — Statistics & Session Quality', () => {
  beforeEach(async () => {
    await db.reading_sessions.clear();
    await db.books.clear();
    await db.series.clear();
    await db.settings.clear();
  });

  describe('Session Quality & Constants', () => {
    it('enforces 5-minute idle timeout and 20s minimum duration', () => {
      expect(IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000); // 300,000 ms
      expect(MIN_SESSION_DURATION_SEC).toBe(20);
    });

    it('formats duration strings accurately', () => {
      expect(formatDuration(0)).toBe('0m');
      expect(formatDuration(45)).toBe('1m');
      expect(formatDuration(60)).toBe('1m');
      expect(formatDuration(3600)).toBe('1h');
      expect(formatDuration(5400)).toBe('1h 30m');
      expect(formatDuration(86400)).toBe('24h');
    });
  });

  describe('Hand-Calculated Fixture: 30 Seeded Sessions Across Time Zones & Midnight', () => {
    // Reference base time: 2026-10-15 12:00:00 IST (+05:30)
    // 2026-10-15 12:00:00 IST = 2026-10-15 06:30:00 UTC = 1792045800000 ms
    const BASE_IST_NOON = 1792045800000;
    const TIMEZONE = 'Asia/Kolkata';

    function makeSession(params: {
      id?: string;
      book_id: string;
      started_at: number;
      duration_sec: number;
      words_read?: number;
      kind?: 'book' | 'manga';
      deleted_at?: number | null;
      start_percent?: number;
      end_percent?: number;
    }): ReadingSession {
      const duration_sec = params.duration_sec;
      return {
        id: params.id ?? uid(),
        book_id: params.book_id,
        started_at: params.started_at,
        ended_at: params.started_at + duration_sec * 1000,
        duration_sec,
        start_percent: params.start_percent ?? 0,
        end_percent: params.end_percent ?? 1,
        words_read: params.words_read ?? 0,
        device_id: 'test-device',
        kind: params.kind ?? 'book',
        created_at: params.started_at,
        updated_at: params.started_at,
        deleted_at: params.deleted_at ?? null,
        _dirty: 0,
      };
    }

    it('processes 30 seeded sessions and matches exact hand-calculated metrics', () => {
      // 30 seeded sessions:
      // Day 0: 2026-10-15 (Today)
      // Day -1: 2026-10-14
      // Day -2: 2026-10-13
      // Day -3: 2026-10-12
      // Day -4: 2026-10-11
      // Day -6: 2026-10-09 (gap on Day -5 -> breaks streak!)

      const DAY = 86400 * 1000;
      const fixture: ReadingSession[] = [];

      // Session 1: Book, Day 0 morning (08:00 IST), 30 min (1800s), 600 words
      fixture.push(
        makeSession({
          id: 's-01',
          book_id: 'b-1',
          started_at: BASE_IST_NOON - 4 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 600,
          kind: 'book',
        }),
      );

      // Session 2: Book, Day 0 afternoon (14:00 IST), 45 min (2700s), 900 words
      fixture.push(
        makeSession({
          id: 's-02',
          book_id: 'b-1',
          started_at: BASE_IST_NOON + 2 * 3600 * 1000,
          duration_sec: 2700,
          words_read: 900,
          kind: 'book',
        }),
      );

      // Session 3: Manga, Day 0 evening (20:00 IST), 20 min (1200s), 40 pages
      fixture.push(
        makeSession({
          id: 's-03',
          book_id: 'm-1',
          started_at: BASE_IST_NOON + 8 * 3600 * 1000,
          duration_sec: 1200,
          words_read: 40,
          kind: 'manga',
        }),
      );

      // Session 4: Discarded session (< 20s): Day 0, 15 seconds
      fixture.push(
        makeSession({
          id: 's-04',
          book_id: 'b-1',
          started_at: BASE_IST_NOON + 9 * 3600 * 1000,
          duration_sec: 15,
          words_read: 5,
          kind: 'book',
        }),
      );

      // Session 5: Deleted session (should be ignored): Day 0, 600s
      fixture.push(
        makeSession({
          id: 's-05',
          book_id: 'b-1',
          started_at: BASE_IST_NOON + 10 * 3600 * 1000,
          duration_sec: 600,
          words_read: 200,
          deleted_at: BASE_IST_NOON,
        }),
      );

      // Session 6: Midnight Boundary crossing!
      // Starts Day -1 at 23:45 IST, ends Day 0 at 00:15 IST (30 min = 1800s), 600 words
      // 2026-10-15 00:00 IST is BASE_IST_NOON - 12 * 3600 * 1000
      const midnightDay0 = BASE_IST_NOON - 12 * 3600 * 1000;
      fixture.push(
        makeSession({
          id: 's-06',
          book_id: 'b-2',
          started_at: midnightDay0 - 15 * 60 * 1000,
          duration_sec: 1800,
          words_read: 600,
          kind: 'book',
        }),
      );

      // Session 7: Day -1 afternoon (15:00 IST), 60 min (3600s), 1500 words
      fixture.push(
        makeSession({
          id: 's-07',
          book_id: 'b-2',
          started_at: midnightDay0 - 9 * 3600 * 1000,
          duration_sec: 3600,
          words_read: 1500,
          kind: 'book',
        }),
      );

      // Session 8: Manga, Day -1 evening (21:00 IST), 15 min (900s), 30 pages
      fixture.push(
        makeSession({
          id: 's-08',
          book_id: 'm-2',
          started_at: midnightDay0 - 3 * 3600 * 1000,
          duration_sec: 900,
          words_read: 30,
          kind: 'manga',
        }),
      );

      // Session 9-12: Day -2 (2026-10-13)
      const dayMinus2Noon = BASE_IST_NOON - 2 * DAY;
      fixture.push(
        makeSession({
          id: 's-09',
          book_id: 'b-1',
          started_at: dayMinus2Noon - 3 * 3600 * 1000,
          duration_sec: 2400,
          words_read: 800,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-10',
          book_id: 'm-1',
          started_at: dayMinus2Noon + 2 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 50,
          kind: 'manga',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-11',
          book_id: 'b-3',
          started_at: dayMinus2Noon + 6 * 3600 * 1000,
          duration_sec: 1200,
          words_read: 400,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-12',
          book_id: 'b-1',
          started_at: dayMinus2Noon + 9 * 3600 * 1000,
          duration_sec: 18, // < 20s discarded
          words_read: 5,
        }),
      );

      // Session 13-16: Day -3 (2026-10-12)
      const dayMinus3Noon = BASE_IST_NOON - 3 * DAY;
      fixture.push(
        makeSession({
          id: 's-13',
          book_id: 'b-2',
          started_at: dayMinus3Noon - 2 * 3600 * 1000,
          duration_sec: 3000,
          words_read: 1000,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-14',
          book_id: 'm-2',
          started_at: dayMinus3Noon + 3 * 3600 * 1000,
          duration_sec: 1500,
          words_read: 45,
          kind: 'manga',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-15',
          book_id: 'b-1',
          started_at: dayMinus3Noon + 7 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 600,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-16',
          book_id: 'b-2',
          started_at: dayMinus3Noon + 10 * 3600 * 1000,
          duration_sec: 10, // < 20s discarded
          words_read: 2,
        }),
      );

      // Session 17-20: Day -4 (2026-10-11)
      const dayMinus4Noon = BASE_IST_NOON - 4 * DAY;
      fixture.push(
        makeSession({
          id: 's-17',
          book_id: 'b-3',
          started_at: dayMinus4Noon - 4 * 3600 * 1000,
          duration_sec: 3600,
          words_read: 1200,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-18',
          book_id: 'm-1',
          started_at: dayMinus4Noon + 1 * 3600 * 1000,
          duration_sec: 2100,
          words_read: 60,
          kind: 'manga',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-19',
          book_id: 'b-1',
          started_at: dayMinus4Noon + 5 * 3600 * 1000,
          duration_sec: 900,
          words_read: 300,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-20',
          book_id: 'b-2',
          started_at: dayMinus4Noon + 8 * 3600 * 1000,
          duration_sec: 12, // < 20s discarded
          words_read: 4,
        }),
      );

      // Note: Day -5 (2026-10-10) has NO SESSIONS -> deliberate gap to test streak boundary!

      // Session 21-25: Day -6 (2026-10-09)
      const dayMinus6Noon = BASE_IST_NOON - 6 * DAY;
      fixture.push(
        makeSession({
          id: 's-21',
          book_id: 'b-1',
          started_at: dayMinus6Noon - 2 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 600,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-22',
          book_id: 'm-2',
          started_at: dayMinus6Noon + 1 * 3600 * 1000,
          duration_sec: 1200,
          words_read: 35,
          kind: 'manga',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-23',
          book_id: 'b-2',
          started_at: dayMinus6Noon + 4 * 3600 * 1000,
          duration_sec: 2400,
          words_read: 800,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-24',
          book_id: 'b-3',
          started_at: dayMinus6Noon + 8 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 600,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-25',
          book_id: 'b-1',
          started_at: dayMinus6Noon + 10 * 3600 * 1000,
          duration_sec: 19, // < 20s discarded
          words_read: 2,
        }),
      );

      // Session 26-30: Older sessions Day -7 & Day -8
      const dayMinus7Noon = BASE_IST_NOON - 7 * DAY;
      const dayMinus8Noon = BASE_IST_NOON - 8 * DAY;
      fixture.push(
        makeSession({
          id: 's-26',
          book_id: 'b-2',
          started_at: dayMinus7Noon,
          duration_sec: 2400,
          words_read: 800,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-27',
          book_id: 'm-1',
          started_at: dayMinus7Noon + 4 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 50,
          kind: 'manga',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-28',
          book_id: 'b-3',
          started_at: dayMinus8Noon,
          duration_sec: 3600,
          words_read: 1200,
          kind: 'book',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-29',
          book_id: 'm-2',
          started_at: dayMinus8Noon + 3 * 3600 * 1000,
          duration_sec: 1200,
          words_read: 30,
          kind: 'manga',
        }),
      );
      fixture.push(
        makeSession({
          id: 's-30',
          book_id: 'b-1',
          started_at: dayMinus8Noon + 6 * 3600 * 1000,
          duration_sec: 1800,
          words_read: 600,
          kind: 'book',
        }),
      );

      expect(fixture.length).toBe(30);

      // Compute stats for all time
      const stats = computeReadingStats(fixture, 'all', {
        timeZone: TIMEZONE,
        now: BASE_IST_NOON,
      });

      // Valid sessions (excluding discarded < 20s [s-04, s-12, s-16, s-20, s-25] and deleted [s-05]):
      // 30 - 5 (<20s) - 1 (deleted) = 24 valid sessions.
      // Sum of durations:
      // s-01: 1800
      // s-02: 2700
      // s-03: 1200
      // s-06: 1800
      // s-07: 3600
      // s-08: 900
      // s-09: 2400
      // s-10: 1800
      // s-11: 1200
      // s-13: 3000
      // s-14: 1500
      // s-15: 1800
      // s-17: 3600
      // s-18: 2100
      // s-19: 900
      // s-21: 1800
      // s-22: 1200
      // s-23: 2400
      // s-24: 1800
      // s-26: 2400
      // s-27: 1800
      // s-28: 3600
      // s-29: 1200
      // s-30: 1800
      // Total duration = 48,300 seconds = 805 minutes = 13h 25m
      expect(stats.totalDurationSec).toBe(48300);
      expect(stats.totalDurationFormatted).toBe('13h 25m');

      // Longest session = 3600s (1h)
      expect(stats.longestSessionSec).toBe(3600);
      expect(stats.longestSessionFormatted).toBe('1h');

      // Book sessions:
      // s-01 (1800, 600w), s-02 (2700, 900w), s-06 (1800, 600w), s-07 (3600, 1500w),
      // s-09 (2400, 800w), s-11 (1200, 400w), s-13 (3000, 1000w), s-15 (1800, 600w),
      // s-17 (3600, 1200w), s-19 (900, 300w), s-21 (1800, 600w), s-23 (2400, 800w),
      // s-24 (1800, 600w), s-26 (2400, 800w), s-28 (3600, 1200w), s-30 (1800, 600w)
      // Total Book Duration = 37,200s
      // Total Book Words = 12,500 words
      // WPM = (12,500 / 37,200) * 60 = 20.16 -> rounded 20 wpm
      expect(stats.bookSpeedWpm).toBe(20);

      // Manga sessions:
      // s-03 (1200, 40p), s-08 (900, 30p), s-10 (1800, 50p), s-14 (1500, 45p),
      // s-18 (2100, 60p), s-22 (1200, 35p), s-27 (1800, 50p), s-29 (1200, 30p)
      // Total Manga Duration = 11,700s
      // Total Manga Pages = 340 pages
      // PPM = (340 / 11,700) * 60 = 1.7 ppm
      expect(stats.mangaSpeedPpm).toBe(1.7);

      // Streaks:
      // Active days:
      // Day 0 (2026-10-15): Yes
      // Day -1 (2026-10-14): Yes
      // Day -2 (2026-10-13): Yes
      // Day -3 (2026-10-12): Yes
      // Day -4 (2026-10-11): Yes
      // Day -5 (2026-10-10): NO (Gap!)
      // Day -6 (2026-10-09): Yes
      // Day -7 (2026-10-08): Yes
      // Day -8 (2026-10-07): Yes
      // Current streak = 5 days (Day 0, -1, -2, -3, -4)
      // Longest streak = 5 days
      expect(stats.currentStreak).toBe(5);
      expect(stats.longestStreak).toBe(5);
    });

    it('correctly splits sessions across local midnight boundaries in Asia/Kolkata', () => {
      // 2026-10-14 23:45 IST to 2026-10-15 00:15 IST (30 minutes = 1800s)
      const midnightDay0 = BASE_IST_NOON - 12 * 3600 * 1000;
      const crossingSession = makeSession({
        id: 'cross-1',
        book_id: 'b-cross',
        started_at: midnightDay0 - 15 * 60 * 1000,
        duration_sec: 1800,
        words_read: 600,
        kind: 'book',
      });

      const segments = splitSessionByMidnight(crossingSession, TIMEZONE);
      expect(segments.length).toBe(2);

      // Day 1 segment
      expect(segments[0].dateKey).toBe('2026-10-14');
      expect(segments[0].durationSec).toBe(900); // 15 min
      expect(segments[0].wordsRead).toBe(300);

      // Day 2 segment
      expect(segments[1].dateKey).toBe('2026-10-15');
      expect(segments[1].durationSec).toBe(900); // 15 min
      expect(segments[1].wordsRead).toBe(300);
    });
  });

  describe('Benchmark Performance: 5,000 Sessions Across 2 Years (< 200 ms)', () => {
    it('computes reading stats for 5,000 sessions in under 200 ms', () => {
      const NUM_SESSIONS = 5000;
      const DAY = 86400 * 1000;
      const START_TIME = Date.now() - 730 * DAY; // 2 years ago

      const syntheticSessions: ReadingSession[] = [];
      for (let i = 0; i < NUM_SESSIONS; i++) {
        // Distribute sessions randomly across 730 days
        const dayOffset = (i % 730) * DAY;
        const hourOffset = (i % 24) * 3600 * 1000;
        const started_at = START_TIME + dayOffset + hourOffset;
        const duration_sec = 600 + (i % 3000); // between 10m and 60m

        syntheticSessions.push({
          id: `bench-${i}`,
          book_id: `book-${i % 20}`,
          started_at,
          ended_at: started_at + duration_sec * 1000,
          duration_sec,
          start_percent: (i % 100) / 100,
          end_percent: ((i % 100) + 1) / 100,
          words_read: Math.round(duration_sec * 4),
          device_id: 'bench-dev',
          kind: i % 5 === 0 ? 'manga' : 'book',
          created_at: started_at,
          updated_at: started_at,
          deleted_at: null,
          _dirty: 0,
        });
      }

      expect(syntheticSessions.length).toBe(5000);

      const startTime = performance.now();
      const stats = computeReadingStats(syntheticSessions, 'year', {
        timeZone: 'Asia/Kolkata',
      });
      const elapsedMs = performance.now() - startTime;

      // Acceptance criterion: under 200 ms
      expect(elapsedMs).toBeLessThan(200);
      expect(stats.totalDurationSec).toBeGreaterThan(0);
      expect(stats.dailyBarChart.length).toBeGreaterThan(0);
      expect(stats.heatmap.length).toBe(52 * 7);
    });
  });

  describe('CSV Export Format', () => {
    it('exports sessions to compliant CSV format with properly escaped fields', () => {
      const bookMap = new Map<string, Book>([
        [
          'b-1',
          {
            id: 'b-1',
            title: 'Pride and Prejudice, Special "Collector\'s" Edition',
            author: 'Jane Austen',
            file_hash: 'h1',
            format: 'EPUB',
            file_size: 1024,
            cover_hash: null,
            added_at: 1000,
            last_opened_at: 2000,
            meta: {},
            created_at: 1000,
            updated_at: 2000,
            deleted_at: null,
            _dirty: 0,
          },
        ],
      ]);
      const seriesMap = new Map<string, Series>();

      const testSession: ReadingSession = {
        id: 's-csv-1',
        book_id: 'b-1',
        started_at: 1792045800000,
        ended_at: 1792047600000,
        duration_sec: 1800,
        start_percent: 0.1,
        end_percent: 0.25,
        words_read: 600,
        device_id: 'dev-1',
        kind: 'book',
        created_at: 1792045800000,
        updated_at: 1792047600000,
        deleted_at: null,
        _dirty: 0,
      };

      const csv = exportSessionsToCsv([testSession], bookMap, seriesMap, 'Asia/Kolkata');
      const lines = csv.split('\r\n');

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe(
        'Session ID,Item ID,Title,Kind,Started At,Ended At,Duration (min),Duration (sec),Start %,End %,Words/Pages Read,Device ID',
      );
      // Escaped title with comma and quotes
      expect(lines[1]).toContain('"Pride and Prejudice, Special ""Collector\'s"" Edition"');
      expect(lines[1]).toContain('30.0');
      expect(lines[1]).toContain('1800');
      expect(lines[1]).toContain('600');
    });
  });

  describe('Reading Goals Store & Synced Settings', () => {
    it('returns default goals and persists custom goals', async () => {
      const defaultGoals = await getReadingGoals();
      expect(defaultGoals.dailyMinutes).toBe(DEFAULT_GOALS.dailyMinutes);
      expect(defaultGoals.yearlyBooks).toBe(DEFAULT_GOALS.yearlyBooks);

      await setReadingGoals({ dailyMinutes: 45, yearlyBooks: 35 });
      const updated = await getReadingGoals();
      expect(updated.dailyMinutes).toBe(45);
      expect(updated.yearlyBooks).toBe(35);

      const dbRow = await db.settings.get('reading_goals');
      expect(dbRow).toBeDefined();
      expect(dbRow?._dirty).toBe(1);
    });
  });
});
