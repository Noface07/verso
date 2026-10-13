import { useEffect, useRef, useCallback } from 'react';
import { db, deviceId, dirty, uid, type ReadingSession } from '../db';

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity
export const MIN_SESSION_DURATION_SEC = 20; // Sessions < 20s are discarded
export const MAX_SESSION_DURATION_SEC = 4 * 3600; // Cap at 4 hours

export interface ReadingSessionOptions {
  kind?: 'book' | 'manga';
  pagesReadRef?: { current: number };
  idleTimeoutMs?: number;
}

export function useReadingSession(
  bookId: string,
  active: boolean,
  fractionRef: { current: number },
  wordCount?: number,
  options?: ReadingSessionOptions,
) {
  const kind = options?.kind ?? 'book';
  const idleTimeout = options?.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const lastActiveRef = useRef<number>(0);
  const isIdleRef = useRef<boolean>(false);
  const startRef = useRef<number>(0);
  const startFracRef = useRef<number>(0);
  const startPagesRef = useRef<number>(0);

  const saveSession = useCallback(
    (startTime: number, endTime: number, startFrac: number, endFrac: number, pagesCount: number) => {
      const seconds = Math.round((endTime - startTime) / 1000);
      if (seconds < MIN_SESSION_DURATION_SEC || !bookId) return;

      const durationSec = Math.min(seconds, MAX_SESSION_DURATION_SEC);
      const wordsRead =
        kind === 'book'
          ? Math.max(0, Math.round((endFrac - startFrac) * (wordCount ?? 0)))
          : pagesCount;

      const session: ReadingSession = {
        id: uid(),
        book_id: bookId,
        started_at: startTime,
        ended_at: endTime,
        duration_sec: durationSec,
        start_percent: startFrac,
        end_percent: endFrac,
        words_read: wordsRead,
        device_id: deviceId(),
        kind,
        deleted_at: null,
        ...dirty(),
      };

      void db.reading_sessions.put(session);
    },
    [bookId, kind, wordCount],
  );

  const flush = useCallback(() => {
    if (startRef.current <= 0 || isIdleRef.current) return;
    const now = Date.now();
    const effectiveEndTime = Math.min(now, lastActiveRef.current > 0 ? lastActiveRef.current : now);
    const endFrac = fractionRef.current;
    const currentPages = options?.pagesReadRef?.current ?? 0;
    const pagesRead = Math.max(0, currentPages - startPagesRef.current);

    saveSession(startRef.current, effectiveEndTime, startFracRef.current, endFrac, pagesRead);

    // Reset session start tracking
    startRef.current = 0;
    isIdleRef.current = false;
  }, [fractionRef, options?.pagesReadRef, saveSession]);

  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActiveRef.current = now;

    if (isIdleRef.current || startRef.current === 0) {
      // User was idle or starting a new session block
      startRef.current = now;
      startFracRef.current = fractionRef.current;
      startPagesRef.current = options?.pagesReadRef?.current ?? 0;
      isIdleRef.current = false;
    }
  }, [fractionRef, options?.pagesReadRef]);

  useEffect(() => {
    if (!active) return;

    const now = Date.now();
    startRef.current = now;
    lastActiveRef.current = now;
    startFracRef.current = fractionRef.current;
    startPagesRef.current = options?.pagesReadRef?.current ?? 0;
    isIdleRef.current = false;

    // Check for idle every 15 seconds
    const checkInterval = window.setInterval(() => {
      if (isIdleRef.current || startRef.current === 0) return;
      const idleTime = Date.now() - lastActiveRef.current;
      if (idleTime >= idleTimeout) {
        // 5 min inactivity reached: end session at last activity time
        const endFrac = fractionRef.current;
        const currentPages = options?.pagesReadRef?.current ?? 0;
        const pagesRead = Math.max(0, currentPages - startPagesRef.current);

        saveSession(startRef.current, lastActiveRef.current, startFracRef.current, endFrac, pagesRead);

        isIdleRef.current = true;
        startRef.current = 0;
      }
    }, 15000);

    // Activity event listeners
    const handleActivity = () => {
      recordActivity();
    };

    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('wheel', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      } else {
        recordActivity();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    return () => {
      window.clearInterval(checkInterval);
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [active, bookId, flush, idleTimeout, options?.pagesReadRef, recordActivity, saveSession, fractionRef]);

  return { recordActivity, flush };
}