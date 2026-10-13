// Device-local MangaDex content-rating preference. Adult ratings stay off unless
// the reader explicitly opts in (with an 18+ confirmation in Settings).
export type ContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic'

const KEY = 'folio_manga_ratings'
const DEFAULT: ContentRating[] = ['safe', 'suggestive']
const listeners = new Set<() => void>()

export function getContentRatings(): ContentRating[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ContentRating[] | null
    if (Array.isArray(raw) && raw.length) return ['safe', ...raw.filter((r) => r !== 'safe')]
  } catch {
    // Corrupt or unavailable storage: fall back to the safe default.
  }
  return [...DEFAULT]
}

export function setContentRating(rating: ContentRating, enabled: boolean): ContentRating[] {
  if (rating === 'safe') return getContentRatings()
  const next = new Set(getContentRatings())
  if (enabled) next.add(rating)
  else next.delete(rating)
  const list = [...next]
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable: the change applies until reload.
  }
  listeners.forEach((l) => l())
  return list
}

export function onContentRatingsChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
