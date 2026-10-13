import { useEffect } from 'react'
import { db, deviceId, dirty, uid } from '../db'

export function useReadingSession(
  bookId: string,
  active: boolean,
  fractionRef: { current: number },
  wordCount: number | undefined,
) {
  useEffect(() => {
    if (!active) return
    let start = Date.now()
    let startFrac = fractionRef.current

    const flush = () => {
      const end = Date.now()
      const seconds = Math.round((end - start) / 1000)
      const endFrac = fractionRef.current
      if (seconds >= 20) {
        void db.reading_sessions.put({
          id: uid(),
          book_id: bookId,
          started_at: start,
          ended_at: end,
          duration_sec: Math.min(seconds, 4 * 3600),
          start_percent: startFrac,
          end_percent: endFrac,
          words_read: Math.max(0, Math.round((endFrac - startFrac) * (wordCount ?? 0))),
          device_id: deviceId(),
          deleted_at: null,
          ...dirty(),
        })
      }
      start = Date.now()
      startFrac = endFrac
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
      else {
        start = Date.now()
        startFrac = fractionRef.current
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [bookId, active, fractionRef, wordCount])
}