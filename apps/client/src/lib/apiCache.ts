import { db } from '../db'

// Device-local cache for catalog API responses (db.kv is not synced). Fresh entries
// are returned without a request; a stale entry is returned if the live request
// hasn't answered within `staleWaitMs`, and the live answer still refreshes it.
const PREFIX = 'cache:'

export interface CacheOptions {
  freshMs: number
  staleWaitMs?: number
}

export async function cachedJson<T>(key: string, load: () => Promise<T>, opts: CacheOptions): Promise<T> {
  const k = PREFIX + key
  const hit = (await db.kv.get(k).catch(() => undefined))?.value as { at: number; data: T } | undefined
  const isEmpty = Array.isArray(hit?.data) && hit.data.length === 0
  if (hit && !isEmpty && Date.now() - hit.at < opts.freshMs) return hit.data

  const live = load().then((data) => {
    if (!Array.isArray(data) || data.length > 0) {
      void db.kv.put({ key: k, value: { at: Date.now(), data } }).catch(() => {})
    }
    return data
  })
  if (!hit || isEmpty) return live
  return Promise.race([
    live,
    new Promise<T>((resolve) => setTimeout(() => resolve(hit.data), opts.staleWaitMs ?? 4000)),
  ]).catch(() => hit.data)
}

/** Removes every cached catalog response (and the older Gutendex-only keys). */
export async function clearApiCache(): Promise<number> {
  const keys = (await db.kv.toCollection().primaryKeys()) as string[]
  const stale = keys.filter((k) => k.startsWith(PREFIX) || k.startsWith('gutendex:'))
  await db.kv.bulkDelete(stale)
  return stale.length
}
