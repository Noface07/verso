import { useEffect, useState } from 'react'
import { db, type Book } from '../db'

export function useCoverUrl(id: string, coverHash: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    setUrl(null)
    if (coverHash) {
      void db.covers.get(id).then((c) => {
        if (c && alive) {
          made = URL.createObjectURL(c.blob)
          setUrl(made)
        }
      })
    }
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [id, coverHash])
  return url
}

export function BookCover({ book }: { book: Book }) {
  const url = useCoverUrl(book.id, book.cover_hash)
  if (url) return <img className="cover" src={url} alt="" loading="lazy" draggable={false} />
  const hue = parseInt(book.id.slice(0, 6), 16) % 360
  return (
    <div className="cover cover-fallback" style={{ background: `hsl(${hue} 32% 36%)` }}>
      <span className="cf-title">{book.title}</span>
      <span className="cf-author">{book.author}</span>
    </div>
  )
}