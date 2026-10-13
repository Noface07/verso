import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { NotebookPen, Search, StickyNote } from 'lucide-react'
import { db, type Annotation, type Book } from '../db'
import { compareCFI } from '../lib/foliate'
import { HIGHLIGHT_COLORS, colorHex } from '../lib/readerSettings'
import { fmtDate } from '../lib/format'
import { BookCover } from '../components/BookCover'

function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>
}

export default function Notebook() {
  const navigate = useNavigate()
  const annotations = useLiveQuery(
    () => db.annotations.filter((a) => !a.deleted_at && a.type !== 'bookmark').toArray(),
    [],
    [] as Annotation[],
  )
  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[])
  const [q, setQ] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const [notesOnly, setNotesOnly] = useState(false)

  const groups = useMemo(() => {
    const bookMap = new Map(books.map((b) => [b.id, b]))
    const needle = q.trim().toLowerCase()
    const byBook = new Map<string, Annotation[]>()
    for (const a of annotations) {
      if (!bookMap.has(a.book_id)) continue
      if (color && a.color !== color) continue
      if (notesOnly && !a.note) continue
      if (needle && !`${a.text} ${a.note} ${a.chapter}`.toLowerCase().includes(needle)) continue
      byBook.set(a.book_id, [...(byBook.get(a.book_id) ?? []), a])
    }
    return [...byBook.entries()]
      .map(([id, list]) => ({
        book: bookMap.get(id)!,
        items: list.sort((x, y) => compareCFI(x.cfi, y.cfi) || x.created_at - y.created_at),
        latest: Math.max(...list.map((a) => a.updated_at)),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [annotations, books, q, color, notesOnly])

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const needle = q.trim()

  return (
    <div className="library notebook">
      <header className="page-head">
        <h1 className="page-title">Notebook</h1>
        <label className="search">
          <Search size={16} />
          <input placeholder="Search all your highlights and notes" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </header>

      <div className="lib-toolbar">
        <div className="nb-colors">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.id}
              className={`swatch ${color === c.id ? 'active' : ''}`}
              style={{ background: c.hex }}
              title={`Only ${c.label.toLowerCase()}`}
              onClick={() => setColor(color === c.id ? null : c.id)}
            />
          ))}
        </div>
        <button className={`chip ${notesOnly ? 'active' : ''}`} onClick={() => setNotesOnly(!notesOnly)}>
          <StickyNote size={14} /> With notes
        </button>
        <span className="spacer" />
        <span className="muted small">{total} {total === 1 ? 'item' : 'items'}</span>
      </div>

      {annotations.length === 0 ? (
        <div className="empty">
          <NotebookPen size={48} strokeWidth={1.2} />
          <h2>No highlights yet</h2>
          <p>Select text while reading to highlight it or add a note. Everything you mark shows up here.</p>
        </div>
      ) : groups.length === 0 ? (
        <p className="empty">Nothing matches.</p>
      ) : (
        groups.map(({ book, items }) => (
          <section key={book.id} className="nb-book">
            <div className="nb-book-head">
              <div className="nb-cover"><BookCover book={book} /></div>
              <div>
                <h3>{book.title}</h3>
                <div className="muted small">{book.author} · {items.length} {items.length === 1 ? 'item' : 'items'}</div>
              </div>
            </div>
            {items.map((a) => (
              <button
                key={a.id}
                className="nb-card"
                style={{ '--c': colorHex(a.color) } as CSSProperties}
                onClick={() => navigate(`/read/${a.book_id}?cfi=${encodeURIComponent(a.cfi)}`)}
              >
                <div className="nb-text"><Marked text={a.text} q={needle} /></div>
                {a.note && <div className="nb-note"><StickyNote size={13} /> <Marked text={a.note} q={needle} /></div>}
                <div className="nb-meta">{a.chapter && <span>{a.chapter} · </span>}{fmtDate(a.created_at)}</div>
              </button>
            ))}
          </section>
        ))
      )}
    </div>
  )
}