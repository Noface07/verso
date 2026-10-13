import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, dirty, type CollectionBook } from '../db'

export const FAVORITES = 'favorites'

export function useFavoriteIds(): Set<string> {
  const rows = useLiveQuery(
    () => db.collection_books.where('collection_id').equals(FAVORITES).filter((r) => !r.deleted_at).toArray(),
    [],
    [] as CollectionBook[],
  )
  return useMemo(() => new Set(rows.map((r) => r.book_id)), [rows])
}

export async function setFavorite(bookId: string, favorite: boolean) {
  await db.collection_books.put({
    id: `fav:${bookId}`,
    collection_id: FAVORITES,
    book_id: bookId,
    deleted_at: favorite ? null : Date.now(),
    ...dirty(),
  })
}

export async function toggleFavorite(bookId: string, current?: boolean) {
  if (current !== undefined) {
    await setFavorite(bookId, !current)
  } else {
    const existing = await db.collection_books.get(`fav:${bookId}`)
    const isFav = !!existing && !existing.deleted_at
    await setFavorite(bookId, !isFav)
  }
}