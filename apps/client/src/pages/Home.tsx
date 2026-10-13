import { useMemo } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, CalendarDays, ChevronRight, Clock, Flame, Upload } from 'lucide-react'
import { db, type Book, type Progress, type ReadingSession } from '../db'
import { useFavoriteIds } from '../lib/favourites'
import { BookCover, useCoverUrl } from '../components/BookCover'
import type { ShellContext } from '../components/Shell'

const DAY = 864e5

function readingStats(sessions: ReadingSession[]) {
  const key = (t: number) => new Date(t).toDateString()
  const byDay = new Map<string, number>()
  for (const s of sessions) {
    if (s.deleted_at) continue
    byDay.set(key(s.started_at), (byDay.get(key(s.started_at)) ?? 0) + s.duration_sec)
  }
  const today = Math.round((byDay.get(key(Date.now())) ?? 0) / 60)
  let week = 0
  for (let i = 0; i < 7; i++) week += byDay.get(key(Date.now() - i * DAY)) ?? 0
  let streak = 0
  const d = new Date()
  if (!byDay.has(d.toDateString())) d.setDate(d.getDate() - 1)
  while (byDay.has(d.toDateString())) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return { today, week: Math.round(week / 60), streak }
}

function SectionHead({ title, to, label }: { title: string; to: string; label: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <Link to={to}>{label}<ChevronRight size={16} /></Link>
    </div>
  )
}

function Shelf({ books, empty, onOpen }: { books: Book[]; empty: string; onOpen: (b: Book) => void }) {
  if (!books.length) return <p className="empty-note">{empty}</p>
  return (
    <div className="shelf">
      {books.map((b) => (
        <button key={b.id} className="shelf-item" onClick={() => onOpen(b)} title={b.title}>
          <BookCover book={b} />
          <span className="shelf-title">{b.title}</span>
        </button>
      ))}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { openImport } = useOutletContext<ShellContext>()
  const books = useLiveQuery(() => db.books.filter((b) => !b.deleted_at).toArray(), [], [] as Book[])
  const progressRows = useLiveQuery(() => db.progress.toArray(), [], [] as Progress[])
  const sessions = useLiveQuery(
    () => db.reading_sessions.where('started_at').above(Date.now() - 60 * DAY).toArray(),
    [],
    [] as ReadingSession[],
  )
  const favIds = useFavoriteIds()

  const progress = useMemo(() => new Map(progressRows.map((p) => [p.id, p])), [progressRows])
  const recent = useMemo(
    () => books.filter((b) => b.last_opened_at).sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0)).slice(0, 5),
    [books],
  )
  const favorites = useMemo(() => books.filter((b) => favIds.has(b.id)).slice(0, 10), [books, favIds])
  const added = useMemo(() => [...books].sort((a, b) => b.added_at - a.added_at).slice(0, 12), [books])
  const stats = useMemo(() => readingStats(sessions), [sessions])

  const hero = recent[0]
  const heroCover = useCoverUrl(hero?.id ?? '', hero?.cover_hash ?? null)
  const open = (b: Book) => navigate(`/read/${b.id}`)
  const pct = (b: Book) => Math.round((progress.get(b.id)?.percent ?? 0) * 100)

  if (!books.length) {
    return (
      <div className="home">
        <div className="empty">
          <BookOpen size={52} strokeWidth={1.2} />
          <h2>Welcome to your library</h2>
          <p>Add EPUB, MOBI, AZW3, FB2, CBZ or PDF files to get started. You can also drag them anywhere on this window.</p>
          <button className="btn primary" onClick={openImport}><Upload size={16} />Add books</button>
        </div>
      </div>
    )
  }

  return (
    <div className="home">
      {heroCover && <div className="ambient" style={{ backgroundImage: `url(${heroCover})` }} />}
      <div className="home-grid">
        <section className="home-recent">
          <SectionHead title="Recent reads" to="/library" label="Open library" />
          {hero ? (
            <div className="recent-layout">
              <button className="hero-book" onClick={() => open(hero)} aria-label={`Continue ${hero.title}`}>
                <BookCover book={hero} />
              </button>
              <div className="recent-side">
                <div className="hero-info">
                  <div className="eyebrow">Continue reading</div>
                  <h3>{hero.title}</h3>
                  <div className="muted">{hero.author}</div>
                  {progress.get(hero.id)?.chapter && <div className="muted small">{progress.get(hero.id)?.chapter}</div>}
                  <div className="bar"><span style={{ width: `${pct(hero)}%` }} /></div>
                  <div className="hero-actions">
                    <span className="muted small">{pct(hero)}% read</span>
                    <button className="btn primary" onClick={() => open(hero)}>Resume</button>
                  </div>
                </div>
                {recent.length > 1 && (
                  <div className="mini-grid">
                    {recent.slice(1).map((b) => (
                      <button key={b.id} className="mini-book" onClick={() => open(b)} title={b.title}>
                        <BookCover book={b} />
                        <div className="bar on-cover"><span style={{ width: `${pct(b)}%` }} /></div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="empty-note">Open any book from your library and it will show up here.</p>
          )}
        </section>

        <section className="home-side">
          <div className="stat-cards">
            <div className="stat"><Clock size={18} /><b>{stats.today} min</b><span>today</span></div>
            <div className="stat"><CalendarDays size={18} /><b>{stats.week} min</b><span>this week</span></div>
            <div className="stat"><Flame size={18} /><b>{stats.streak} {stats.streak === 1 ? 'day' : 'days'}</b><span>streak</span></div>
          </div>
          <SectionHead title="Favourite books" to="/library?filter=favorites" label="See more" />
          <Shelf books={favorites} empty="Tap the heart on any book in your library to pin it here." onOpen={open} />
          <SectionHead title="Recently added" to="/library?sort=added" label="See more" />
          <Shelf books={added} empty="" onOpen={open} />
        </section>
      </div>
    </div>
  )
}