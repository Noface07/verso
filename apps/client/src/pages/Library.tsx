import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, Heart, LayoutGrid, MoreHorizontal, Rows3, Search, Trash2, Upload } from 'lucide-react'
import { db, dirty, type Book, type Progress } from '../db'
import { fmtBytes, fmtDate, fmtMinutes } from '../lib/format'
import { setFavorite, useFavoriteIds } from '../lib/favourites'
import { BookCover } from '../components/BookCover'
import { Modal } from '../components/ui'
import type { ShellContext } from '../components/Shell'

type SortKey = 'recent' | 'added' | 'title' | 'author' | 'progress'
type Filter = 'all' | 'favorites' | 'reading' | 'unread' | 'finished'

const FILTERS: [Filter, string][] = [
  ['all', 'All'], ['favorites', 'Favourites'], ['reading', 'Reading'], ['unread', 'Not started'], ['finished', 'Finished'],
]
const SORTS: SortKey[] = ['recent', 'added', 'title', 'author', 'progress']

export default function Library() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { openImport, importing } = useOutletContext<ShellContext>()
  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[])
  const progressRows = useLiveQuery(() => db.progress.toArray(), [], [] as Progress[])
  const favIds = useFavoriteIds()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>(() => {
    const f = params.get('filter') as Filter | null
    return f && FILTERS.some(([x]) => x === f) ? f : 'all'
  })
  const [sort, setSort] = useState<SortKey>(() => {
    const s = (params.get('sort') ?? localStorage.getItem('lib.sort')) as SortKey | null
    return s && SORTS.includes(s) ? s : 'recent'
  })
  const [layout, setLayout] = useState<'grid' | 'list'>(() => (localStorage.getItem('lib.layout') as 'grid' | 'list') || 'grid')
  const [details, setDetails] = useState<Book | null>(null)

  const progress = useMemo(() => new Map(progressRows.map((p) => [p.id, p])), [progressRows])
  const pct = (b: Book) => progress.get(b.id)?.percent ?? 0

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = books.filter((b) => {
      if (q && !`${b.title} ${b.author} ${b.meta.series ?? ''}`.toLowerCase().includes(q)) return false
      const p = progress.get(b.id)?.percent ?? 0
      if (filter === 'favorites') return favIds.has(b.id)
      if (filter === 'reading') return p > 0 && p < 0.99
      if (filter === 'unread') return p === 0
      if (filter === 'finished') return p >= 0.99
      return true
    })
    const cmp: Record<SortKey, (a: Book, b: Book) => number> = {
      recent: (a, b) => (b.last_opened_at ?? b.added_at) - (a.last_opened_at ?? a.added_at),
      added: (a, b) => b.added_at - a.added_at,
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
      progress: (a, b) => (progress.get(b.id)?.percent ?? 0) - (progress.get(a.id)?.percent ?? 0),
    }
    return list.sort(cmp[sort])
  }, [books, progress, favIds, query, filter, sort])

  async function removeBook(b: Book) {
    if (!confirm(`Remove “${b.title}” from your library?`)) return
    await db.books.update(b.id, { deleted_at: Date.now(), ...dirty() })
    await db.files.delete(b.file_hash)
    await db.covers.delete(b.id)
    setDetails(null)
  }

  const open = (b: Book) => navigate(`/read/${b.id}`)

  return (
    <div className="library">
      <header className="page-head">
        <h1 className="page-title">Library</h1>
        <label className="search">
          <Search size={16} />
          <input placeholder="Search title, author or series" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="btn primary add-btn" onClick={openImport} disabled={importing}>
          <Upload size={16} />{importing ? 'Importing…' : 'Add books'}
        </button>
      </header>

      {books.length > 0 && (
        <div className="lib-toolbar">
          <div className="chips">
            {FILTERS.map(([f, label]) => (
              <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{label}</button>
            ))}
          </div>
          <span className="spacer" />
          <span className="muted small">{shown.length} {shown.length === 1 ? 'book' : 'books'}</span>
          <select className="select" value={sort} onChange={(e) => { setSort(e.target.value as SortKey); localStorage.setItem('lib.sort', e.target.value) }}>
            <option value="recent">Recently read</option>
            <option value="added">Recently added</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="progress">Progress</option>
          </select>
          <div className="seg">
            {(['grid', 'list'] as const).map((l) => (
              <button key={l} className={layout === l ? 'active' : ''} aria-label={`${l} view`} onClick={() => { setLayout(l); localStorage.setItem('lib.layout', l) }}>
                {l === 'grid' ? <LayoutGrid size={16} /> : <Rows3 size={16} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {books.length === 0 ? (
        <div className="empty">
          <BookOpen size={48} strokeWidth={1.2} />
          <h2>Your library is empty</h2>
          <p>Drop EPUB, MOBI, AZW3, FB2, CBZ or PDF files anywhere, or use Add books.</p>
          <button className="btn primary" onClick={openImport}><Upload size={16} />Add books</button>
        </div>
      ) : shown.length === 0 ? (
        <p className="empty">{filter === 'favorites' ? 'No favourites yet. Tap the heart on a book cover.' : 'No books match.'}</p>
      ) : layout === 'grid' ? (
        <div className="grid">
          {shown.map((b) => {
            const fav = favIds.has(b.id)
            return (
              <div key={b.id} className="card">
                <div className="card-cover">
                  <button className="card-open" onClick={() => open(b)} aria-label={`Read ${b.title}`}>
                    <BookCover book={b} />
                    {pct(b) > 0 && <div className="bar on-cover"><span style={{ width: `${Math.round(pct(b) * 100)}%` }} /></div>}
                  </button>
                  <button
                    className={`card-fav ${fav ? 'on' : ''}`}
                    aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
                    onClick={() => void setFavorite(b.id, !fav)}
                  >
                    <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="card-meta">
                  <div className="card-title" title={b.title}>{b.title}</div>
                  <div className="card-author">{b.author}</div>
                </div>
                <button className="icon-btn sm card-more" aria-label="Book details" onClick={() => setDetails(b)}>
                  <MoreHorizontal size={16} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="list">
          {shown.map((b) => (
            <div key={b.id} className="row" onClick={() => open(b)}>
              <BookCover book={b} />
              <div className="row-main">
                <div className="row-title">{favIds.has(b.id) && <Heart size={13} fill="currentColor" className="row-heart" />}{b.title}</div>
                <div className="muted small">{b.author}</div>
              </div>
              <div className="muted small row-extra">{b.format} · {fmtBytes(b.file_size)}</div>
              <div className="muted small row-pct">{pct(b) > 0 ? `${Math.round(pct(b) * 100)}%` : 'New'}</div>
              <button className="icon-btn sm" aria-label="Book details" onClick={(e) => { e.stopPropagation(); setDetails(b) }}>
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {details && (
        <DetailsModal
          book={details}
          progress={progress.get(details.id)}
          favorite={favIds.has(details.id)}
          onFavorite={(v) => void setFavorite(details.id, v)}
          onClose={() => setDetails(null)}
          onRead={() => open(details)}
          onRemove={() => void removeBook(details)}
        />
      )}
    </div>
  )
}

function DetailsModal({ book, progress, favorite, onFavorite, onClose, onRead, onRemove }: {
  book: Book
  progress?: Progress
  favorite: boolean
  onFavorite: (v: boolean) => void
  onClose: () => void
  onRead: () => void
  onRemove: () => void
}) {
  const m = book.meta
  const countable = book.format !== 'PDF' && book.format !== 'CBZ'
  const facts: [string, string][] = [
    ['Format', book.format],
    ['File size', fmtBytes(book.file_size)],
    ['Words', !countable ? '—' : m.word_count != null ? m.word_count.toLocaleString() : 'Counting…'],
    ['Paragraphs', !countable ? '—' : m.paragraph_count != null ? m.paragraph_count.toLocaleString() : 'Counting…'],
    ['Reading time', m.word_count ? `about ${fmtMinutes(m.word_count / 250)}` : '—'],
    ['Progress', progress ? `${Math.round(progress.percent * 100)}%` : 'Not started'],
    ['Language', m.language || '—'],
    ['Publisher', m.publisher || '—'],
    ['Series', m.series || '—'],
    ['Added', fmtDate(book.added_at)],
    ['Last opened', book.last_opened_at ? fmtDate(book.last_opened_at) : 'Never'],
  ]
  return (
    <Modal title="Book details" onClose={onClose} width={640}>
      <div className="details">
        <BookCover book={book} />
        <div>
          <h2 className="details-title">{book.title}</h2>
          <div className="muted">{book.author}</div>
          <dl className="facts">
            {facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
          </dl>
        </div>
      </div>
      {m.description && <p className="desc">{m.description}</p>}
      <div className="actions">
        <button className="btn danger" onClick={onRemove}><Trash2 size={16} />Remove</button>
        <span className="spacer" />
        <button className="btn" onClick={() => onFavorite(!favorite)}>
          <Heart size={16} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favourite' : 'Add to favourites'}
        </button>
        <button className="btn primary" onClick={onRead}><BookOpen size={16} />Read</button>
      </div>
    </Modal>
  )
}