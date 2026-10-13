import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, BookMarked, Bookmark, Columns2, Headphones, Highlighter, List,
  Maximize2, Minimize2, RectangleVertical, Search, Type, X,
} from 'lucide-react'
import { db, deviceId, dirty, uid, type Annotation, type HighlightStyle, type Progress } from '../db'
import { CFI, Overlayer, type FoliateView, type TocItem } from '../lib/foliate'
import { THEMES, applyLayout, colorHex, useReaderSettings } from '../lib/readerSettings'
import { useReadingSession } from '../lib/session'
import { ReadAloud, speakOnce, useVoices, type TTSState } from '../lib/tts'
import { SelectionPopover, type MenuAnchor } from '../components/SelectionPopover'
import type { LookupTab } from '../components/LookupCard'
import { TTSBar } from '../components/TTSBar'
import { AnnotationsPanel, NoteEditor, SearchPanel, SettingsPanel, TocPanel } from '../components/ReaderPanels'

type Panel = 'toc' | 'search' | 'notes' | 'bookmarks' | 'settings' | null
const PANEL_TITLE = {
  toc: 'Contents',
  search: 'Search in book',
  notes: 'Highlights & notes',
  bookmarks: 'Bookmarks',
  settings: 'Reading settings',
}

interface Loc {
  fraction: number
  cfi: string
  chapter: string
  href?: string
  snippet: string
  page?: { current: number; total: number }
  minutesLeft?: number
}

interface Pop {
  anchor: MenuAnchor
  cfi: string
  text: string
  doc?: Document
  range?: Range
  annotation?: Annotation
}

const SVG_NS = 'http://www.w3.org/2000/svg'
type DrawRect = { left: number; top: number; width: number; height: number }
type DrawFn = (rects: ArrayLike<DrawRect>, opts: { color: string; width?: number }) => SVGElement

// Wraps a foliate draw function and adds a small dot after highlights that carry a note
function withNoteDot(base: unknown): DrawFn {
  return (rects, opts) => {
    const g = document.createElementNS(SVG_NS, 'g')
    g.append((base as DrawFn)(rects, opts))
    const last = rects[rects.length - 1]
    if (last) {
      const dot = document.createElementNS(SVG_NS, 'circle')
      dot.setAttribute('cx', String(last.left + last.width + 4))
      dot.setAttribute('cy', String(last.top + 3))
      dot.setAttribute('r', '4')
      dot.setAttribute('fill', opts.color)
      g.append(dot)
    }
    return g
  }
}

function toScreen(doc: Document, r: DOMRect): MenuAnchor {
  const f = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect()
  const ox = f?.left ?? 0
  const oy = f?.top ?? 0
  return { x: r.left + ox + r.width / 2, top: r.top + oy, bottom: r.bottom + oy }
}

function navKey(e: KeyboardEvent, view: FoliateView | null) {
  if (!view) return
  const t = e.target as HTMLElement | null
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  switch (e.key) {
    case 'ArrowLeft': view.goLeft(); break
    case 'ArrowRight': view.goRight(); break
    case 'PageUp': void view.prev(); break
    case 'PageDown':
    case ' ': void view.next(); break
    default: return
  }
  e.preventDefault()
}

const toFoliate = (a: Annotation) => ({ value: a.cfi, color: a.color, style: a.style, note: !!a.note })
const isSingleWord = (s: string) => s.length < 40 && /^[\p{L}\p{M}'’-]+$/u.test(s)

export default function Reader() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const stageRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const jumpRef = useRef(params.get('cfi'))

  const [settings, updateSettings] = useReaderSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const book = useLiveQuery(() => db.books.get(id), [id])
  const annotations = useLiveQuery(
    () => db.annotations.where('book_id').equals(id).filter((a) => !a.deleted_at).toArray(),
    [id],
    [] as Annotation[],
  )
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [toc, setToc] = useState<TocItem[]>([])
  const [loc, setLoc] = useState<Loc | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [searchSeed, setSearchSeed] = useState('')
  const [chrome, setChrome] = useState(true)
  const [pop, setPop] = useState<Pop | null>(null)
  const [lookup, setLookup] = useState<LookupTab | null>(null)
  const [noteFor, setNoteFor] = useState<Annotation | null>(null)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [ttsState, setTtsState] = useState<TTSState>('idle')
  const voices = useVoices()

  const fractionRef = useRef(0)
  const rangeRef = useRef<Range | null>(null)
  const ttsRef = useRef<ReadAloud | null>(null)
  const lastAnnotationTap = useRef(0)
  const popOpenRef = useRef(false)
  popOpenRef.current = !!pop
  const drawn = useRef(new Map<string, string>())

  const lang = book?.meta.language || 'en'

  useReadingSession(id, status === 'ready', fractionRef, book?.meta.word_count)

  // Open the book and wire up foliate-js events
  useEffect(() => {
    let cancelled = false
    let view: FoliateView | null = null
    let saveTimer: number | undefined
    let pending: Progress | null = null

    const flushProgress = () => {
      if (pending) {
        void db.progress.put(pending)
        pending = null
      }
    }
    const dispose = () => {
      if (!view) return
      try { view.close() } catch { /* already closed */ }
      view.remove()
      view = null
    }

    const onRelocate = (e: Event) => {
      const d = (e as CustomEvent).detail
      const chapter: string = d.tocItem?.label?.trim() ?? ''
      fractionRef.current = d.fraction ?? 0
      rangeRef.current = d.range ?? null
      ttsRef.current?.setSection(d.section?.current ?? 0)
      setLoc({
        fraction: d.fraction ?? 0,
        cfi: d.cfi ?? '',
        chapter,
        href: d.tocItem?.href,
        snippet: (d.range?.toString?.() ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
        page: d.location ? { current: d.location.current + 1, total: d.location.total } : undefined,
        minutesLeft: d.time?.section,
      })
      if (ttsRef.current?.state !== 'playing') setPop(null)
      if (d.cfi) {
        pending = {
          id, cfi: d.cfi, percent: d.fraction ?? 0, chapter: chapter || null,
          device_id: deviceId(), deleted_at: null, ...dirty(),
        }
        clearTimeout(saveTimer)
        saveTimer = window.setTimeout(flushProgress, 800)
      }
    }

    const readSelection = (doc: Document, index: number) => {
      const s = doc.getSelection()
      if (!s || s.isCollapsed || !s.rangeCount) {
        setPop((cur) => (cur?.doc === doc && !cur.annotation ? null : cur))
        return
      }
      const range = s.getRangeAt(0)
      const text = s.toString().trim()
      if (!text || !view) return
      const cfi = view.getCFI(index, range)
      const existing = annotationsRef.current.find((a) => a.cfi === cfi && a.type !== 'bookmark')
      setPop({ anchor: toScreen(doc, range.getBoundingClientRect()), cfi, text, doc, range: range.cloneRange(), annotation: existing })
      setLookup(settingsRef.current.autoDefine && isSingleWord(text) ? 'define' : null)
    }

    const onLoad = (e: Event) => {
      const { doc, index } = (e as CustomEvent).detail as { doc: Document; index: number }
      let t: number | undefined
      doc.addEventListener('selectionchange', () => {
        clearTimeout(t)
        t = window.setTimeout(() => readSelection(doc, index), 250)
      })
      doc.addEventListener('keydown', (ev) => navKey(ev, viewRef.current))
      doc.addEventListener('click', (ev) => {
        if (Date.now() - lastAnnotationTap.current < 300) return
        if ((ev.target as Element | null)?.closest?.('a')) return
        const s = doc.getSelection()
        if (s && !s.isCollapsed) return
        if (popOpenRef.current) { setPop(null); setLookup(null); return }
        const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect()
        const x = ev.clientX + (frame?.left ?? 0)
        const w = window.innerWidth
        const paged = settingsRef.current.flow === 'paginated'
        if (paged && x < w * 0.25) viewRef.current?.goLeft()
        else if (paged && x > w * 0.75) viewRef.current?.goRight()
        else setChrome((c) => !c)
      })
    }

    const onCreateOverlay = () => {
      for (const a of annotationsRef.current) {
        if (a.type !== 'bookmark') void view?.addAnnotation(toFoliate(a))
      }
    }

    const onDraw = (e: Event) => {
      const { draw, annotation } = (e as CustomEvent).detail as {
        draw: (fn: unknown, opts: object) => void
        annotation: { color?: string; style?: HighlightStyle; note?: boolean }
      }
      const color = colorHex(annotation.color ?? 'yellow')
      const base =
        annotation.style === 'underline' ? Overlayer.underline
        : annotation.style === 'strikethrough' ? Overlayer.strikethrough
        : annotation.style === 'squiggly' ? Overlayer.squiggly
        : Overlayer.highlight
      const opts = annotation.style && annotation.style !== 'highlight' ? { color, width: 2 } : { color }
      draw(annotation.note ? withNoteDot(base) : base, opts)
    }

    const onShowAnnotation = (e: Event) => {
      const { value, range } = (e as CustomEvent).detail as { value: string; range: Range }
      const a = annotationsRef.current.find((x) => x.cfi === value)
      if (!a) return
      lastAnnotationTap.current = Date.now()
      const doc = range.startContainer.ownerDocument
      setLookup(null)
      setPop({
        anchor: doc
          ? toScreen(doc, range.getBoundingClientRect())
          : { x: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2 },
        cfi: a.cfi,
        text: a.text,
        range,
        annotation: a,
      })
    }

    ;(async () => {
      try {
        const row = await db.books.get(id)
        if (!row) throw new Error('This book is not in your library.')
        const stored = await db.files.get(row.file_hash)
        if (!stored) throw new Error('The book file is not on this device yet. It will download once sync is set up.')
        if (cancelled || !stageRef.current) return

        const file = new File([stored.blob], row.meta.file_name || `book.${row.format.toLowerCase()}`, {
          type: row.meta.mime || stored.blob.type,
        })
        view = document.createElement('foliate-view') as FoliateView
        stageRef.current.append(view)
        await view.open(file)
        if (cancelled) return dispose()

        viewRef.current = view
        setToc(view.book.toc ?? [])
        applyLayout(view.renderer, settingsRef.current)
        view.addEventListener('relocate', onRelocate)
        view.addEventListener('load', onLoad)
        view.addEventListener('create-overlay', onCreateOverlay)
        view.addEventListener('draw-annotation', onDraw)
        view.addEventListener('show-annotation', onShowAnnotation)

        const tts = new ReadAloud(view)
        tts.onState = setTtsState
        ttsRef.current = tts

        const saved = await db.progress.get(id)
        if (cancelled) return dispose()
        await view.init({ lastLocation: jumpRef.current || saved?.cfi || undefined, showTextStart: true })
        if (cancelled) return dispose()

        void db.books.update(id, { last_opened_at: Date.now(), ...dirty() })
        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(saveTimer)
      flushProgress()
      ttsRef.current?.stop()
      ttsRef.current = null
      viewRef.current = null
      drawn.current = new Map()
      dispose()
    }
  }, [id])

  // Re-apply layout and styles whenever settings change
  useEffect(() => {
    if (status === 'ready') applyLayout(viewRef.current?.renderer, settings)
  }, [settings, status])

  // Keep voice and speed in sync with settings
  useEffect(() => {
    const t = ttsRef.current
    if (!t) return
    const changed = t.rate !== settings.ttsRate || t.voiceURI !== settings.ttsVoice
    t.rate = settings.ttsRate
    t.voiceURI = settings.ttsVoice
    if (changed) t.restartBlock()
  }, [settings.ttsRate, settings.ttsVoice, status])

  // Keep drawn highlights in sync with the database
  useEffect(() => {
    const view = viewRef.current
    if (!view || status !== 'ready') return
    const next = new Map<string, string>()
    for (const a of annotations) {
      if (a.type !== 'bookmark') next.set(a.cfi, `${a.color}|${a.style}|${a.note ? 1 : 0}`)
    }
    for (const cfi of drawn.current.keys()) {
      if (!next.has(cfi)) void view.deleteAnnotation({ value: cfi })
    }
    for (const [cfi, sig] of next) {
      if (drawn.current.get(cfi) !== sig) {
        const a = annotations.find((x) => x.cfi === cfi)
        if (a) void view.addAnnotation(toFoliate(a))
      }
    }
    drawn.current = next
  }, [annotations, status])

  // Keyboard shortcuts and fullscreen tracking
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPop(null)
        setLookup(null)
        setPanel(null)
        return
      }
      navKey(e, viewRef.current)
    }
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  const pageBookmarks = useMemo(() => {
    if (!loc?.cfi) return []
    try {
      const start = CFI.collapse(loc.cfi)
      const end = CFI.collapse(loc.cfi, true)
      return annotations.filter((a) =>
        a.type === 'bookmark' && CFI.compare(a.cfi, start) >= 0 && CFI.compare(a.cfi, end) <= 0)
    } catch {
      return []
    }
  }, [annotations, loc?.cfi])

  async function addBookmark(cfi: string, text: string) {
    await db.annotations.put({
      id: uid(), book_id: id, type: 'bookmark', cfi, text: text.slice(0, 200), note: '', color: '',
      style: 'highlight', chapter: loc?.chapter ?? '', created_at: Date.now(), deleted_at: null, ...dirty(),
    })
  }

  async function togglePageBookmark() {
    if (!loc?.cfi) return
    if (pageBookmarks.length) {
      await db.annotations.bulkPut(pageBookmarks.map((b) => ({ ...b, deleted_at: Date.now(), ...dirty() })))
    } else {
      await addBookmark(CFI.collapse(loc.cfi), loc.snippet)
    }
  }

  function closePop() {
    pop?.doc?.getSelection()?.removeAllRanges()
    setPop(null)
    setLookup(null)
  }

  async function createHighlight(p: Pop, color: string, style: HighlightStyle): Promise<Annotation> {
    const t = Date.now()
    const a: Annotation = {
      id: uid(), book_id: id, type: 'highlight', cfi: p.cfi, text: p.text, note: '', color, style,
      chapter: loc?.chapter ?? '', created_at: t, deleted_at: null, ...dirty(),
    }
    await db.annotations.put(a)
    return a
  }

  async function applyStyle(color: string, style: HighlightStyle) {
    if (!pop) return
    updateSettings({ lastColor: color, lastStyle: style })
    if (pop.annotation) {
      const next = { ...pop.annotation, color, style, ...dirty() }
      await db.annotations.put(next)
      setPop((p) => (p ? { ...p, annotation: next } : p))
      return
    }
    await createHighlight(pop, color, style)
    closePop()
  }

  async function openNote() {
    if (!pop) return
    const a = pop.annotation ?? (await createHighlight(pop, settings.lastColor, settings.lastStyle))
    closePop()
    setNoteFor(a)
  }

  async function patchAnnotation(a: Annotation, patch: Partial<Annotation>) {
    await db.annotations.put({ ...a, ...patch, ...dirty() })
  }

  async function startReading(from?: Range | null) {
    const t = ttsRef.current
    if (!t) return
    try {
      await t.start(from ?? rangeRef.current)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  function speakText(text: string) {
    if (ttsRef.current?.state === 'playing') ttsRef.current.pause()
    speakOnce(text, lang, settings.ttsVoice, settings.ttsRate)
  }

  const go = (target: string) => {
    void viewRef.current?.goTo(target)
    if (window.innerWidth < 760) setPanel(null)
  }
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p))
  const commitScrub = () => {
    if (scrub === null) return
    void viewRef.current?.goToFraction(scrub)
    setScrub(null)
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  const theme = THEMES[settings.theme] ?? THEMES.light
  const fraction = scrub ?? loc?.fraction ?? 0

  return (
    <div className={`reader ${chrome ? '' : 'hide-chrome'}`} style={{ '--rbg': theme.bg, '--rfg': theme.fg } as CSSProperties}>
      <header className="reader-top">
        <div className="tb-group">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back" title="Back"><ArrowLeft size={20} /></button>
          <button className={`icon-btn ${panel === 'toc' ? 'active' : ''}`} onClick={() => togglePanel('toc')} title="Contents"><List size={20} /></button>
          <button className={`icon-btn ${panel === 'notes' ? 'active' : ''}`} onClick={() => togglePanel('notes')} title="Highlights & notes"><Highlighter size={20} /></button>
          <button className={`icon-btn ${panel === 'bookmarks' ? 'active' : ''}`} onClick={() => togglePanel('bookmarks')} title="Bookmarks"><BookMarked size={20} /></button>
        </div>
        <div className="reader-title">
          <div>{book?.title ?? ''}</div>
          <small>{book?.author}</small>
        </div>
        <div className="tb-group">
          <button className={`icon-btn ${panel === 'search' ? 'active' : ''}`} onClick={() => { setSearchSeed(''); togglePanel('search') }} title="Search"><Search size={20} /></button>
          <button
            className={`icon-btn ${ttsState !== 'idle' ? 'active' : ''}`}
            onClick={() => (ttsState === 'idle' ? void startReading() : ttsRef.current?.stop())}
            title={ttsState === 'idle' ? 'Read aloud' : 'Stop reading'}
          >
            <Headphones size={20} />
          </button>
          <span className="tb-sep" />
          <button className={`icon-btn ${panel === 'settings' ? 'active' : ''}`} onClick={() => togglePanel('settings')} title="Reading settings"><Type size={20} /></button>
          <button
            className="icon-btn hide-mobile"
            onClick={() => updateSettings({ columns: settings.columns === 2 ? 1 : 2 })}
            title={settings.columns === 2 ? 'Single page' : 'Two pages'}
          >
            {settings.columns === 2 ? <RectangleVertical size={20} /> : <Columns2 size={20} />}
          </button>
          <button className="icon-btn" onClick={() => void togglePageBookmark()} title={pageBookmarks.length ? 'Remove bookmark' : 'Bookmark this page'}>
            <Bookmark size={20} fill={pageBookmarks.length ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-btn hide-mobile" onClick={toggleFullscreen} title={fullscreen ? 'Exit full screen' : 'Full screen'}>
            {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
        </div>
      </header>

      <div className="reader-stage" ref={stageRef} />
      {pageBookmarks.length > 0 && <div className="ribbon" aria-hidden="true" />}

      {status === 'loading' && <div className="reader-msg">Opening book…</div>}
      {status === 'error' && (
        <div className="reader-msg">
          <p>{error}</p>
          <button className="btn" onClick={() => navigate('/library')}>Back to library</button>
        </div>
      )}

      <div className="reader-scrub">
        <span className="rb-chapter">
          {loc?.minutesLeft ? `${Math.max(1, Math.ceil(loc.minutesLeft))} min left in chapter` : ''}
        </span>
        <input
          type="range"
          className="progress-range"
          aria-label="Book progress"
          min={0}
          max={1000}
          value={Math.round(fraction * 1000)}
          onChange={(e) => setScrub(Number(e.target.value) / 1000)}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
        />
      </div>

      <footer className="reader-status">
        <span>{loc?.page ? `${loc.page.current} / ${loc.page.total}` : ''}</span>
        <span className="rs-chapter">{loc?.chapter}</span>
        <span>{(fraction * 100).toFixed(2)}%</span>
      </footer>

      {ttsState !== 'idle' && (
        <TTSBar
          state={ttsState}
          rate={settings.ttsRate}
          voiceURI={settings.ttsVoice}
          voices={voices}
          lang={lang}
          onPlayPause={() => (ttsState === 'playing' ? ttsRef.current?.pause() : ttsRef.current?.resume())}
          onPrev={() => ttsRef.current?.prev()}
          onNext={() => ttsRef.current?.next()}
          onStop={() => ttsRef.current?.stop()}
          onRate={(r) => updateSettings({ ttsRate: r })}
          onVoice={(v) => updateSettings({ ttsVoice: v })}
        />
      )}

      {pop && (
        <SelectionPopover
          anchor={pop.anchor}
          text={pop.text}
          color={pop.annotation?.color ?? settings.lastColor}
          style={pop.annotation?.style ?? settings.lastStyle}
          existing={!!pop.annotation}
          hasNote={!!pop.annotation?.note}
          lookup={lookup}
          lang={lang}
          translateTo={settings.translateTo}
          onLookup={setLookup}
          onTranslateTo={(l) => updateSettings({ translateTo: l })}
          onSpeakText={speakText}
          onColor={(c) => void applyStyle(c, pop.annotation?.style ?? settings.lastStyle)}
          onStyle={(s) => void applyStyle(pop.annotation?.color ?? settings.lastColor, s)}
          onNote={() => void openNote()}
          onBookmark={() => { void addBookmark(CFI.collapse(pop.cfi), pop.text); closePop() }}
          onReadAloud={() => { const r = pop.range ?? null; closePop(); void startReading(r) }}
          onSearch={() => { setSearchSeed(pop.text.slice(0, 80)); setPanel('search'); closePop() }}
          onCopy={() => { void navigator.clipboard.writeText(pop.text); closePop() }}
          onDelete={pop.annotation ? () => { void patchAnnotation(pop.annotation!, { deleted_at: Date.now() }); closePop() } : undefined}
        />
      )}

      {panel && (
        <aside className="panel">
          <div className="panel-head">
            <h3>{PANEL_TITLE[panel]}</h3>
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close panel"><X size={18} /></button>
          </div>
          <div className="panel-body">
            {panel === 'toc' && <TocPanel toc={toc} current={loc?.href} onGo={go} />}
            {panel === 'search' && viewRef.current && (
              <SearchPanel key={searchSeed} view={viewRef.current} initial={searchSeed} onGo={go} />
            )}
            {(panel === 'notes' || panel === 'bookmarks') && (
              <AnnotationsPanel
                key={panel}
                initialTab={panel === 'bookmarks' ? 'bookmark' : 'all'}
                annotations={annotations}
                title={book?.title ?? 'Book'}
                author={book?.author ?? ''}
                onGo={go}
                onEditNote={setNoteFor}
                onDelete={(a) => void patchAnnotation(a, { deleted_at: Date.now() })}
              />
            )}
            {panel === 'settings' && <SettingsPanel s={settings} onChange={updateSettings} />}
          </div>
        </aside>
      )}

      {noteFor && (
        <NoteEditor
          annotation={noteFor}
          onClose={() => setNoteFor(null)}
          onSave={async (note) => {
            await patchAnnotation(noteFor, { note: note.trim(), type: note.trim() ? 'note' : 'highlight' })
            setNoteFor(null)
          }}
        />
      )}
    </div>
  )
}