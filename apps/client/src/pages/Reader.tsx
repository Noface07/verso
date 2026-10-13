import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, BookMarked, Bookmark, Columns2, ExternalLink, Headphones, Highlighter, List,
  Maximize2, Minimize2, RectangleVertical, Search, Type, Undo2, X,
} from 'lucide-react'
import { db, deviceId, dirty, uid, type Annotation, type HighlightStyle, type Progress } from '../db'
import { CFI, Overlayer, type FoliateView, type TocItem } from '../lib/foliate'
import { applyLayout, colorHex, getEffectiveTheme, useReaderSettings } from '../lib/readerSettings'
import { loadCustomFontFaceCSS } from '../lib/customFonts'
import { useReadingSession } from '../lib/session'
import { ReadAloud, speakOnce, useVoices, type TTSState } from '../lib/tts'
import { SelectionPopover, type MenuAnchor } from '../components/SelectionPopover'
import { LookupCard, type LookupTab } from '../components/LookupCard'
import { TTSBar } from '../components/TTSBar'
import { AnnotationsPanel, NoteEditor, SearchPanel, SettingsPanel, TocPanel } from '../components/ReaderPanels'
import { QuoteCardShare } from '../components/QuoteCardShare'
import { IconButton } from '../design/components/IconButton'
import { Button } from '../design/components/Button'
import { ShortcutsDialog } from '../design/components/ShortcutsDialog'
import { ImageViewerDialog } from '../design/components/ImageViewerDialog'
import { FocusTrap } from '../design/components/FocusTrap'
import { InfoBar } from '../design/components/InfoBar'
import { getFile } from '../features/sync/api'
import { getRefreshToken } from '../features/auth/storage'
import { useWheelPaging } from '../lib/useWheelPaging'
import { useReaderTouch } from '../lib/useReaderTouch'
import { isInputTarget } from '../lib/useHotkeys'
import { registerBackHandler } from '../lib/backStack'
import { setKeepScreenOn, triggerHaptic, useVolumeKeys } from '../lib/mobileUx'

type Panel = 'toc' | 'search' | 'notes' | 'bookmarks' | 'settings' | 'lookup' | null
const PANEL_TITLE: Record<Exclude<Panel, null>, string> = {
  toc: 'Contents',
  search: 'Search in book',
  notes: 'Highlights & notes',
  bookmarks: 'Bookmarks',
  settings: 'Reading settings',
  lookup: 'Dictionary & Lookup',
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

export function isFootnoteRef(a?: Element | null, href?: string): boolean {
  if (!a && !href) return false
  if (a) {
    const type = a.getAttribute('epub:type') || a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''
    const role = a.getAttribute('role') || ''
    const cls = a.getAttribute('class') || ''
    if (type.includes('noteref') || role === 'doc-noteref' || /(\bnoteref\b|\bfootnote-ref\b)/i.test(cls)) return true
    if (a.matches('sup a, a sup') || a.closest('sup')) return true
  }
  if (href) {
    const lower = href.toLowerCase()
    if (/#(fn|footnote|note|ref)[-_0-9]/i.test(lower) || lower.includes('#fn') || lower.includes('#note')) return true
  }
  return false
}

export default function Reader() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const stageRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const jumpRef = useRef(params.get('cfi'))

  const [settings, updateSettings] = useReaderSettings()
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const book = useLiveQuery(() => db.books.get(id), [id])
  const annotations = useLiveQuery(
    () => db.annotations.where('book_id').equals(id).filter((a) => !a.deleted_at).toArray(),
    [id],
    [] as Annotation[],
  )
  const annotationsRef = useRef(annotations)
  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  const [viewInstance, setViewInstance] = useState<FoliateView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const remoteProgress = useLiveQuery(() => db.progress.get(id), [id])
  const [conflict, setConflict] = useState<{
    device: string
    chapter: string
    percent: number
    cfi: string
  } | null>(null)
  const dismissedConflictCfi = useRef<string | null>(null)

  useEffect(() => {
    if (!remoteProgress || !remoteProgress.cfi || !viewInstance) return
    const myDeviceId = deviceId()
    if (remoteProgress.device_id && remoteProgress.device_id !== myDeviceId) {
      const diff = remoteProgress.percent - fractionRef.current
      if (diff > 0.01 && dismissedConflictCfi.current !== remoteProgress.cfi) {
        void (async () => {
          const dev = await db.devices.get(remoteProgress.device_id)
          setConflict({
            device: dev?.name || 'another device',
            chapter: remoteProgress.chapter || '',
            percent: remoteProgress.percent,
            cfi: remoteProgress.cfi,
          })
        })()
      }
    }
  }, [remoteProgress, viewInstance])

  const [toc, setToc] = useState<TocItem[]>([])
  const [loc, setLoc] = useState<Loc | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [searchSeed, setSearchSeed] = useState('')
  const [chrome, setChrome] = useState(true)
  const [pop, setPop] = useState<Pop | null>(null)
  const [lookup, setLookup] = useState<LookupTab | null>(null)
  const [noteFor, setNoteFor] = useState<Annotation | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt?: string } | null>(null)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [ttsState, setTtsState] = useState<TTSState>('idle')
  const [expandedLookupWord, setExpandedLookupWord] = useState('')
  const [quoteShareText, setQuoteShareText] = useState<string | null>(null)
  const [externalLinkPrompt, setExternalLinkPrompt] = useState<string | null>(null)
  const [footnotePopup, setFootnotePopup] = useState<{ text: string; href: string; anchor: MenuAnchor } | null>(null)
  const [navHistory, setNavHistory] = useState<string[]>([])
  const [customFontCSS, setCustomFontCSS] = useState('')
  const currentChapterRef = useRef('')
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const voices = useVoices()

  const { attachDocument } = useWheelPaging({
    view: viewInstance,
    settings,
    onFontSizeChange: (newSize) => updateSettings({ fontSize: newSize }),
  })
  const attachDocRef = useRef(attachDocument)
  useEffect(() => {
    attachDocRef.current = attachDocument
  }, [attachDocument])

  const { attachDocument: attachTouchDoc } = useReaderTouch({
    view: viewInstance,
    flow: settings.flow,
    onImageZoom: (src, alt) => setZoomedImage({ src, alt }),
  })
  const attachTouchDocRef = useRef(attachTouchDoc)
  useEffect(() => {
    attachTouchDocRef.current = attachTouchDoc
  }, [attachTouchDoc])

  // Keep screen on while reading (P11.1 & P11.3)
  useEffect(() => {
    const shouldKeepOn = status === 'ready' && (settings.keepScreenOn ?? true)
    void setKeepScreenOn(shouldKeepOn)
    return () => {
      void setKeepScreenOn(false)
    }
  }, [status, settings.keepScreenOn])

  // Volume keys for page turns (P11.5)
  useVolumeKeys(
    () => {
      viewInstance?.next?.()
      if (settings.haptics ?? true) triggerHaptic('light')
    },
    () => {
      viewInstance?.prev?.()
      if (settings.haptics ?? true) triggerHaptic('light')
    },
    status === 'ready' && !!settings.volumeKeysTurn,
  )

  // Register Android back handler stack (P11.1 & P11.3)
  useEffect(() => {
    return registerBackHandler(() => {
      if (zoomedImage) {
        setZoomedImage(null)
        return true
      }
      if (quoteShareText) {
        setQuoteShareText(null)
        return true
      }
      if (externalLinkPrompt) {
        setExternalLinkPrompt(null)
        return true
      }
      if (footnotePopup) {
        setFootnotePopup(null)
        return true
      }
      if (shortcutsOpen) {
        setShortcutsOpen(false)
        return true
      }
      if (noteFor) {
        setNoteFor(null)
        return true
      }
      if (panel) {
        setPanel(null)
        return true
      }
      if (pop) {
        setPop(null)
        return true
      }
      return false
    }, 50)
  }, [zoomedImage, quoteShareText, externalLinkPrompt, footnotePopup, shortcutsOpen, noteFor, panel, pop])

  const fractionRef = useRef(0)
  const rangeRef = useRef<Range | null>(null)
  const ttsRef = useRef<ReadAloud | null>(null)
  const lastAnnotationTap = useRef(0)
  const popOpenRef = useRef(false)
  useEffect(() => {
    popOpenRef.current = !!pop
  }, [pop])
  const drawn = useRef(new Map<string, string>())

  const lang = book?.meta.language || 'en'

  const [showFinishedPrompt, setShowFinishedPrompt] = useState(false)
  const dismissedFinishedRef = useRef(false)

  useEffect(() => {
    if (!book || book.meta.finished_at || dismissedFinishedRef.current) return
    const currentFraction = loc?.fraction ?? 0
    if (currentFraction >= 0.99) {
      const promptTimer = window.setTimeout(() => {
        if (!dismissedFinishedRef.current) {
          setShowFinishedPrompt(true)
        }
      }, 5000)

      const autoMarkTimer = window.setTimeout(async () => {
        if (!dismissedFinishedRef.current) {
          await db.books.update(book.id, {
            meta: { ...book.meta, finished_at: Date.now() },
            ...dirty(),
          })
          setShowFinishedPrompt(false)
        }
      }, 60000)

      return () => {
        clearTimeout(promptTimer)
        clearTimeout(autoMarkTimer)
      }
    } else {
      setShowFinishedPrompt(false)
    }
  }, [loc?.fraction, book])

  const handleMarkFinished = async () => {
    if (!book) return
    await db.books.update(book.id, {
      meta: { ...book.meta, finished_at: Date.now() },
      ...dirty(),
    })
    setShowFinishedPrompt(false)
  }

  const { recordActivity } = useReadingSession(id, status === 'ready', fractionRef, book?.meta.word_count)

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
      recordActivity()
      const d = (e as CustomEvent).detail
      const chapter: string = d.tocItem?.label?.trim() ?? ''
      fractionRef.current = d.fraction ?? 0
      rangeRef.current = d.range ?? null
      ttsRef.current?.setSection(d.section?.current ?? 0)
      if (settingsRef.current.ttsSleepTimer === -1 && chapter && currentChapterRef.current && chapter !== currentChapterRef.current) {
        ttsRef.current?.stop()
        updateSettings({ ttsSleepTimer: 0 })
      }
      currentChapterRef.current = chapter
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
      attachDocRef.current(doc)
      attachTouchDocRef.current(doc)
      let t: number | undefined
      doc.addEventListener('selectionchange', () => {
        clearTimeout(t)
        t = window.setTimeout(() => readSelection(doc, index), 250)
      })
      doc.addEventListener('keydown', (ev) => onKeyRef.current(ev))
      doc.addEventListener('dblclick', (ev) => {
        const img = (ev.target as HTMLElement | null)?.closest?.('img')
        if (img instanceof HTMLImageElement && img.src) {
          setZoomedImage({ src: img.src, alt: img.alt || '' })
        }
      })
      doc.addEventListener('contextmenu', (ev) => {
        const s = doc.getSelection()
        if (s && !s.isCollapsed) {
          ev.preventDefault()
          readSelection(doc, index)
          return
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contents = (viewRef.current?.renderer as any)?.getContents?.() ?? []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = contents.find((item: any) => item.doc === doc) ?? contents[0]
        const [value, range] = c?.overlayer?.hitTest?.(ev) ?? []
        if (value) {
          ev.preventDefault()
          const a = annotationsRef.current.find((x) => x.cfi === value)
          if (a && range) {
            lastAnnotationTap.current = Date.now()
            setLookup(null)
            setPop({
              anchor: toScreen(doc, range.getBoundingClientRect()),
              cfi: a.cfi,
              text: a.text,
              range,
              annotation: a,
            })
          }
        }
      })
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
        if (paged) {
          if (x < w * 0.25) {
            if (settingsRef.current.tapZones === 'allNext') viewRef.current?.goRight()
            else viewRef.current?.goLeft()
          } else if (x > w * 0.75) {
            viewRef.current?.goRight()
          } else {
            setChrome((c) => !c)
          }
        } else {
          setChrome((c) => !c)
        }
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
        let stored = await db.files.get(row.file_hash)
        if (!stored) {
          const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
          const refreshToken = await getRefreshToken()
          if (!isOnline) {
            throw new Error('Book file not downloaded. Connect to the internet to download it from your server.')
          }
          if (!refreshToken) {
            throw new Error('The book file is not on this device. Sign in to your account to download it.')
          }
          setDownloading(true)
          try {
            const blob = await getFile(row.file_hash)
            await db.files.put({ hash: row.file_hash, blob })
            stored = { hash: row.file_hash, blob }
          } catch (dlErr) {
            throw new Error(`Failed to download book: ${dlErr instanceof Error ? dlErr.message : 'network error'}`, { cause: dlErr })
          } finally {
            setDownloading(false)
          }
        }
        if (cancelled || !stageRef.current) return

        const file = new File([stored.blob], row.meta.file_name || `book.${row.format.toLowerCase()}`, {
          type: row.meta.mime || stored.blob.type,
        })
        view = document.createElement('foliate-view') as FoliateView
        stageRef.current.append(view)
        await view.open(file)
        if (cancelled) return dispose()

        viewRef.current = view
        setViewInstance(view)
        setToc(view.book.toc ?? [])
        applyLayout(view.renderer, settingsRef.current, customFontCSS)
        view.addEventListener('relocate', onRelocate)
        view.addEventListener('load', onLoad)
        view.addEventListener('create-overlay', onCreateOverlay)
        view.addEventListener('draw-annotation', onDraw)
        view.addEventListener('show-annotation', onShowAnnotation)

        const onExternalLink = (e: Event) => {
          e.preventDefault()
          const d = (e as CustomEvent).detail as { a?: HTMLAnchorElement; href_?: string; href?: string }
          const url = d.href_ || d.href || ''
          if (url) setExternalLinkPrompt(url)
        }

        const onInternalLink = (e: Event) => {
          const d = (e as CustomEvent).detail as { a?: HTMLAnchorElement; href: string }
          const a = d.a
          const href = d.href
          if (isFootnoteRef(a, href)) {
            e.preventDefault()
            let text = ''
            const targetId = href.includes('#') ? href.split('#')[1] : ''
            const doc = a?.ownerDocument
            if (targetId && doc) {
              const el = doc.getElementById(targetId) || doc.querySelector(`[id="${targetId}"]`)
              if (el) text = el.textContent?.trim() || ''
            }
            if (!text && a) {
              text = a.getAttribute('title') || a.getAttribute('aria-label') || ''
            }
            if (!text) {
              text = 'Footnote reference: ' + href
            }
            const rect = a?.getBoundingClientRect()
            const anchor: MenuAnchor = doc && rect
              ? toScreen(doc, rect)
              : { x: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2 }
            setFootnotePopup({ text, href, anchor })
            return
          }

          if (locRef.current?.cfi) {
            setNavHistory((hist) => [...hist, locRef.current!.cfi])
          }
        }

        view.addEventListener('external-link', onExternalLink)
        view.addEventListener('link', onInternalLink)

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
      setViewInstance(null)
      drawn.current = new Map()
      dispose()
    }
  }, [id])

  const locRef = useRef<Loc | null>(null)
  useEffect(() => {
    locRef.current = loc
  }, [loc])

  useEffect(() => {
    void loadCustomFontFaceCSS().then(setCustomFontCSS)
  }, [settings.font])

  // Re-apply layout and styles whenever settings or custom font CSS changes
  useEffect(() => {
    if (status === 'ready') applyLayout(viewRef.current?.renderer, settings, customFontCSS)
  }, [settings, status, customFontCSS])

  // Restore preferred voice for book language
  useEffect(() => {
    if (lang && settings.ttsVoiceMap?.[lang] && settings.ttsVoiceMap[lang] !== settings.ttsVoice) {
      updateSettings({ ttsVoice: settings.ttsVoiceMap[lang] })
    }
  }, [lang, settings.ttsVoiceMap, settings.ttsVoice, updateSettings])

  // Sleep timer for read-aloud (in minutes)
  useEffect(() => {
    if (ttsState !== 'playing' || !settings.ttsSleepTimer || settings.ttsSleepTimer <= 0) return
    const ms = settings.ttsSleepTimer * 60 * 1000
    const timer = window.setTimeout(() => {
      ttsRef.current?.stop()
      updateSettings({ ttsSleepTimer: 0 })
    }, ms)
    return () => clearTimeout(timer)
  }, [ttsState, settings.ttsSleepTimer, updateSettings])

  // Auto-paging timer
  useEffect(() => {
    if (!settings.autoPaging || status !== 'ready') return
    const intervalMs = Math.max(3, settings.autoPagingInterval || 15) * 1000
    const timer = window.setInterval(() => {
      if (!pop && !panel && !zoomedImage && !quoteShareText && !externalLinkPrompt && !footnotePopup) {
        void viewRef.current?.next()
      }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [settings.autoPaging, settings.autoPagingInterval, status, pop, panel, zoomedImage, quoteShareText, externalLinkPrompt, footnotePopup])

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

  // Refs to allow onKey to read current state without recreating listeners
  const shortcutsOpenRef = useRef(shortcutsOpen)
  useEffect(() => { shortcutsOpenRef.current = shortcutsOpen }, [shortcutsOpen])
  const panelRef = useRef(panel)
  useEffect(() => { panelRef.current = panel }, [panel])
  const lookupRef = useRef(lookup)
  useEffect(() => { lookupRef.current = lookup }, [lookup])
  const popRef = useRef(pop)
  useEffect(() => { popRef.current = pop }, [pop])
  const zoomedImageRef = useRef(zoomedImage)
  useEffect(() => { zoomedImageRef.current = zoomedImage }, [zoomedImage])
  const quoteShareTextRef = useRef(quoteShareText)
  useEffect(() => { quoteShareTextRef.current = quoteShareText }, [quoteShareText])
  const externalLinkPromptRef = useRef(externalLinkPrompt)
  useEffect(() => { externalLinkPromptRef.current = externalLinkPrompt }, [externalLinkPrompt])
  const footnotePopupRef = useRef(footnotePopup)
  useEffect(() => { footnotePopupRef.current = footnotePopup }, [footnotePopup])

  // Keyboard shortcuts and fullscreen tracking per §5.4
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape handling: Close topmost layer
      if (e.key === 'Escape') {
        if (quoteShareTextRef.current) {
          setQuoteShareText(null)
          e.preventDefault()
          return
        }
        if (externalLinkPromptRef.current) {
          setExternalLinkPrompt(null)
          e.preventDefault()
          return
        }
        if (footnotePopupRef.current) {
          setFootnotePopup(null)
          e.preventDefault()
          return
        }
        if (zoomedImageRef.current) {
          setZoomedImage(null)
          e.preventDefault()
          return
        }
        if (shortcutsOpenRef.current) {
          setShortcutsOpen(false)
          e.preventDefault()
          return
        }
        if (popRef.current) {
          closePop()
          e.preventDefault()
          return
        }
        if (lookupRef.current) {
          setLookup(null)
          e.preventDefault()
          return
        }
        if (panelRef.current) {
          setPanel(null)
          e.preventDefault()
          return
        }
        if (document.fullscreenElement) {
          void document.exitFullscreen()
          e.preventDefault()
          return
        }
        return
      }

      // If user is focused on an input/textarea, suppress reader shortcuts
      if (isInputTarget(e.target)) return

      const isCtrlOrCmd = e.ctrlKey || e.metaKey

      // ? / Shift+/: Shortcuts help dialog
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
        return
      }

      // Ctrl+F: Search in book panel
      if (isCtrlOrCmd && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setPanel((p) => (p === 'search' ? null : 'search'))
        return
      }

      // Ctrl+= / Ctrl++: Font size increase
      if (isCtrlOrCmd && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        const cur = settingsRef.current.fontSize
        updateSettings({ fontSize: Math.min(36, cur + 1) })
        return
      }

      // Ctrl+- / Ctrl+_: Font size decrease
      if (isCtrlOrCmd && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        const cur = settingsRef.current.fontSize
        updateSettings({ fontSize: Math.max(12, cur - 1) })
        return
      }

      // T: Contents panel
      if (!isCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setPanel((p) => (p === 'toc' ? null : 'toc'))
        return
      }

      // B: Bookmark toggle
      if (!isCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        void togglePageBookmark()
        return
      }

      // H: Highlights & notes panel
      if (!isCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setPanel((p) => (p === 'notes' ? null : 'notes'))
        return
      }

      // F: Fullscreen toggle
      if (!isCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleFullscreen()
        return
      }

      // R: Read aloud play/pause
      if (!isCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        ttsRef.current?.toggle()
        return
      }

      navKey(e, viewRef.current)
    }

    onKeyRef.current = onKey
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [updateSettings])

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
  }, [annotations, loc])

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
    if (window.innerWidth < 768) setPanel(null)
  }
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p))
  const commitScrub = () => {
    if (scrub === null) return
    void viewRef.current?.goToFraction(scrub)
    setScrub(null)
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  const theme = getEffectiveTheme(settings)
  const fraction = scrub ?? loc?.fraction ?? 0

  const isLeftPanel = panel === 'toc' || panel === 'notes' || panel === 'bookmarks'
  const isRightPanel = panel === 'search' || panel === 'settings' || panel === 'lookup'

  const renderPanelContent = () => {
    if (!panel) return null
    if (panel === 'toc') return <TocPanel toc={toc} current={loc?.href} onGo={go} />
    if (panel === 'search' && viewInstance) {
      return <SearchPanel key={searchSeed} view={viewInstance} initial={searchSeed} onGo={go} />
    }
    if (panel === 'notes' || panel === 'bookmarks') {
      return (
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
      )
    }
    if (panel === 'settings') return <SettingsPanel s={settings} onChange={updateSettings} />
    if (panel === 'lookup') {
      return (
        <LookupCard
          text={expandedLookupWord}
          tab={lookup ?? 'define'}
          onTab={setLookup}
          lang={lang}
          translateTo={settings.translateTo}
          onTranslateTo={(l) => updateSettings({ translateTo: l })}
          onSpeak={speakText}
          onClose={() => setPanel(null)}
        />
      )
    }
    return null
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden flex flex-col select-none"
      style={{
        backgroundColor: 'var(--rbg)',
        color: 'var(--rfg)',
        '--rbg': theme.bg,
        '--rfg': theme.fg,
        '--rmuted': `color-mix(in srgb, ${theme.fg} 55%, ${theme.bg})`,
        '--rline': `color-mix(in srgb, ${theme.fg} 12%, ${theme.bg})`,
        '--rsurface': `color-mix(in srgb, ${theme.fg} 6%, ${theme.bg})`,
      } as CSSProperties}
    >
      {/* Top chrome header */}
      <header
        className={`fixed top-0 inset-x-0 h-12 z-30 transition-all duration-200 ease-[var(--ease-out)] bg-[color-mix(in_srgb,var(--rbg)_90%,transparent)] backdrop-blur-[var(--blur)] border-b border-[var(--rline)] flex items-center justify-between px-3 ${
          chrome ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-1 shrink-0">
          <IconButton label="Back" icon={<ArrowLeft className="w-4.5 h-4.5" />} onClick={() => navigate(-1)} />
          <IconButton
            label="Contents"
            icon={<List className="w-4.5 h-4.5" />}
            variant={panel === 'toc' ? 'accent' : 'subtle'}
            onClick={() => togglePanel('toc')}
          />
          <IconButton
            label="Highlights & notes"
            icon={<Highlighter className="w-4.5 h-4.5" />}
            variant={panel === 'notes' ? 'accent' : 'subtle'}
            onClick={() => togglePanel('notes')}
          />
          <IconButton
            label="Bookmarks"
            icon={<BookMarked className="w-4.5 h-4.5" />}
            variant={panel === 'bookmarks' ? 'accent' : 'subtle'}
            onClick={() => togglePanel('bookmarks')}
          />
        </div>

        <div className="flex-1 min-w-0 px-4 text-center select-none">
          <div className="font-display font-semibold text-sm truncate text-[var(--rfg)]">{book?.title ?? ''}</div>
          <div className="text-xs text-[var(--rmuted)] truncate">{book?.author}</div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            label="Search in book"
            icon={<Search className="w-4.5 h-4.5" />}
            variant={panel === 'search' ? 'accent' : 'subtle'}
            onClick={() => { setSearchSeed(''); togglePanel('search') }}
          />
          <IconButton
            label={ttsState === 'idle' ? 'Read aloud' : 'Stop reading'}
            icon={<Headphones className="w-4.5 h-4.5" />}
            variant={ttsState !== 'idle' ? 'accent' : 'subtle'}
            onClick={() => (ttsState === 'idle' ? void startReading() : ttsRef.current?.stop())}
          />
          <span className="w-px h-5 mx-1 bg-[var(--rline)]" />
          <IconButton
            label="Reading settings"
            icon={<Type className="w-4.5 h-4.5" />}
            variant={panel === 'settings' ? 'accent' : 'subtle'}
            onClick={() => togglePanel('settings')}
          />
          <IconButton
            className="hidden sm:inline-flex"
            label={settings.columns === 2 ? 'Single page' : 'Two pages'}
            icon={settings.columns === 2 ? <RectangleVertical className="w-4.5 h-4.5" /> : <Columns2 className="w-4.5 h-4.5" />}
            onClick={() => updateSettings({ columns: settings.columns === 2 ? 1 : 2 })}
          />
          <IconButton
            label={pageBookmarks.length ? 'Remove bookmark' : 'Bookmark this page'}
            icon={<Bookmark className={`w-4.5 h-4.5 ${pageBookmarks.length ? 'fill-[var(--accent)] text-[var(--accent)]' : ''}`} />}
            onClick={() => void togglePageBookmark()}
          />
          <IconButton
            className="hidden sm:inline-flex"
            label={fullscreen ? 'Exit full screen' : 'Full screen'}
            icon={fullscreen ? <Minimize2 className="w-4.5 h-4.5" /> : <Maximize2 className="w-4.5 h-4.5" />}
            onClick={toggleFullscreen}
          />
        </div>
      </header>

      {/* Progress conflict banner */}
      {conflict && (
        <div className="fixed top-14 inset-x-4 z-40 max-w-xl mx-auto animate-in fade-in-0 slide-in-from-top-2">
          <InfoBar
            severity="info"
            message={`You're further along on ${conflict.device}: ${conflict.chapter ? conflict.chapter + ', ' : ''}${Math.round(conflict.percent * 100)}%. Jump there?`}
            action={
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => {
                    dismissedConflictCfi.current = conflict.cfi
                    void viewRef.current?.goTo(conflict.cfi)
                    setConflict(null)
                  }}
                >
                  Jump
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    dismissedConflictCfi.current = conflict.cfi
                    setConflict(null)
                  }}
                >
                  Stay
                </Button>
              </div>
            }
            onClose={() => {
              dismissedConflictCfi.current = conflict.cfi
              setConflict(null)
            }}
          />
        </div>
      )}

      {/* Main viewport with docked side panels */}
      <main
        className="flex-1 flex overflow-hidden relative transition-all duration-200"
        style={{
          paddingTop: chrome ? '48px' : '0px',
          paddingBottom: chrome ? '72px' : '28px',
        }}
      >
        {/* Left docked panel (360px on desktop) */}
        {panel && isLeftPanel && (
          <FocusTrap
            onClose={() => setPanel(null)}
            className="hidden md:flex w-[360px] h-full shrink-0 border-r border-[var(--rline)] bg-[var(--rbg)] flex-col z-10 animate-in slide-in-from-left duration-200"
          >
            <aside className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between h-12 px-4 border-b border-[var(--rline)] shrink-0">
                <h3 className="font-display font-semibold text-sm">{PANEL_TITLE[panel]}</h3>
                <IconButton label="Close panel" icon={<X className="w-4 h-4" />} size="sm" onClick={() => setPanel(null)} />
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {renderPanelContent()}
              </div>
            </aside>
          </FocusTrap>
        )}

        {/* Reading stage */}
        <div className="flex-1 h-full relative overflow-hidden">
          <div className="w-full h-full relative" ref={stageRef} />

          {/* Night light warm amber overlay */}
          {settings.nightLight > 0 && (
            <div
              className="absolute inset-0 pointer-events-none z-10 transition-opacity"
              style={{
                backgroundColor: '#ff8c00',
                opacity: settings.nightLight / 100,
                mixBlendMode: 'multiply',
              }}
              aria-hidden="true"
            />
          )}

          {/* Dim brightness overlay */}
          {settings.dimOverlay > 0 && (
            <div
              className="absolute inset-0 pointer-events-none z-10 transition-opacity"
              style={{
                backgroundColor: '#000000',
                opacity: settings.dimOverlay / 100,
              }}
              aria-hidden="true"
            />
          )}

          {/* Bookmark ribbon */}
          {pageBookmarks.length > 0 && (
            <div
              className="absolute top-0 right-6 z-10 w-[18px] h-[30px] bg-[var(--danger)] shadow-sm pointer-events-none transition-all duration-150"
              style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 74%, 0 100%)' }}
              aria-hidden="true"
            />
          )}

          {status === 'loading' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--rbg)] text-[var(--rmuted)]">
              <div className="w-8 h-8 rounded-full border-2 border-[var(--rline)] border-t-[var(--accent)] animate-spin" />
              <span className="text-sm">{downloading ? 'Downloading from your server…' : 'Opening book…'}</span>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 p-6 bg-[var(--rbg)] text-center text-[var(--rmuted)]">
              <p className="max-w-md text-sm text-[var(--danger)]">{error}</p>
              <Button variant="standard" onClick={() => navigate('/library')}>
                Back to library
              </Button>
            </div>
          )}
        </div>

        {/* Right docked panel (360px on desktop) */}
        {panel && isRightPanel && (
          <FocusTrap
            onClose={() => setPanel(null)}
            className="hidden md:flex w-[360px] h-full shrink-0 border-l border-[var(--rline)] bg-[var(--rbg)] flex-col z-10 animate-in slide-in-from-right duration-200"
          >
            <aside className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between h-12 px-4 border-b border-[var(--rline)] shrink-0">
                <h3 className="font-display font-semibold text-sm">{PANEL_TITLE[panel]}</h3>
                <IconButton label="Close panel" icon={<X className="w-4 h-4" />} size="sm" onClick={() => setPanel(null)} />
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {renderPanelContent()}
              </div>
            </aside>
          </FocusTrap>
        )}
      </main>

      {/* Mobile Bottom Sheet for panels (< 768px) */}
      {panel && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 border-none p-0 cursor-default"
            onClick={() => setPanel(null)}
          />
          <FocusTrap
            onClose={() => setPanel(null)}
            className="relative z-10 w-full max-h-[85vh] rounded-t-2xl bg-[var(--rbg)] border-t border-[var(--rline)] shadow-[var(--shadow-flyout)] flex flex-col animate-in slide-in-from-bottom duration-200"
          >
            <aside className="w-full h-full flex flex-col">
              <div className="w-10 h-1 rounded-full bg-[var(--rline)] mx-auto mt-2.5 mb-1" />
              <div className="flex items-center justify-between h-11 px-4 border-b border-[var(--rline)] shrink-0">
                <h3 className="font-display font-semibold text-sm">{PANEL_TITLE[panel]}</h3>
                <IconButton label="Close panel" icon={<X className="w-4 h-4" />} size="sm" onClick={() => setPanel(null)} />
              </div>
              <div className="flex-1 overflow-y-auto p-4 pb-8">
                {renderPanelContent()}
              </div>
            </aside>
          </FocusTrap>
        </div>
      )}

      {/* Scrub bar */}
      <div
        className={`fixed bottom-7 inset-x-0 h-11 z-30 transition-all duration-200 ease-[var(--ease-out)] bg-[color-mix(in_srgb,var(--rbg)_92%,transparent)] backdrop-blur-[var(--blur)] border-t border-[var(--rline)] flex items-center gap-3 px-4 text-xs text-[var(--rmuted)] select-none ${
          chrome ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <span className="shrink-0 w-36 truncate text-[11px] font-medium hidden sm:inline">
          {loc?.minutesLeft ? `${Math.max(1, Math.ceil(loc.minutesLeft))} min left in chapter` : loc?.chapter || ''}
        </span>

        <div className="flex-1 relative flex items-center">
          {scrub !== null && (
            <div
              className="absolute -top-7 px-2 py-0.5 rounded-[var(--r-sm)] bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] text-[11px] font-mono shadow-md -translate-x-1/2 pointer-events-none"
              style={{ left: `${Math.round(fraction * 100)}%` }}
            >
              {(fraction * 100).toFixed(1)}%
            </div>
          )}
          <input
            type="range"
            className="w-full h-1.5 rounded-full cursor-pointer appearance-none bg-[var(--rline)] accent-[var(--rfg)] outline-none"
            aria-label="Book progress"
            min={0}
            max={1000}
            value={Math.round(fraction * 1000)}
            onChange={(e) => setScrub(Number(e.target.value) / 1000)}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
          />
        </div>

        <span className="shrink-0 w-12 text-right font-mono text-[11px] tabular-nums">
          {(fraction * 100).toFixed(1)}%
        </span>
      </div>

      {/* 28px Status line */}
      <footer className="fixed bottom-0 inset-x-0 h-7 z-20 flex items-center justify-between px-4 text-[12px] opacity-55 text-[var(--rfg)] bg-[var(--rbg)] font-mono tabular-nums select-none pointer-events-none border-t border-[var(--rline)]/40">
        <span>{loc?.page ? `${loc.page.current} / ${loc.page.total}` : ''}</span>
        <span className="truncate max-w-[50vw] px-2 text-center">{loc?.chapter || ''}</span>
        <span>{(fraction * 100).toFixed(2)}%</span>
      </footer>

      {/* Auto-paging status pill */}
      {settings.autoPaging && (
        <div className="fixed top-14 right-4 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--layer-solid)] border border-[var(--stroke)] text-[11px] font-medium text-[var(--text-1)] shadow-sm animate-in fade-in duration-150">
          <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
          <span>Auto-paging ({settings.autoPagingInterval || 15}s)</span>
          <button
            type="button"
            className="ml-1 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
            onClick={() => updateSettings({ autoPaging: false })}
            title="Stop auto-paging"
            aria-label="Stop auto-paging"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Internal link navigation history "Back to where you were" chip */}
      {navHistory.length > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Button
            variant="accent"
            size="sm"
            className="shadow-[var(--shadow-flyout)] flex items-center gap-1.5 text-xs h-8 px-3"
            onClick={() => {
              const last = navHistory[navHistory.length - 1]
              setNavHistory((h) => h.slice(0, h.length - 1))
              if (last) void viewRef.current?.goTo(last)
            }}
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Back to where you were</span>
          </Button>
        </div>
      )}

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
          onVoice={(v) =>
            updateSettings({
              ttsVoice: v,
              ttsVoiceMap: { ...(settings.ttsVoiceMap || {}), [lang]: v },
            })
          }
          sleepTimer={settings.ttsSleepTimer}
          onSleepTimer={(mins) => updateSettings({ ttsSleepTimer: mins })}
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
          onExpandLookup={() => {
            setExpandedLookupWord(pop.text)
            setPanel('lookup')
            closePop()
          }}
          onShareQuote={() => {
            setQuoteShareText(pop.text)
            closePop()
          }}
        />
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

      {/* Footnote popup flyout */}
      {footnotePopup && (
        <div
          role="dialog"
          aria-label="Footnote"
          className="fixed z-50 max-w-sm p-4 rounded-xl bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] animate-in fade-in-0 zoom-in-95 duration-150"
          style={{
            left: Math.min(Math.max(footnotePopup.anchor.x - 160, 16), window.innerWidth - 336),
            top: footnotePopup.anchor.bottom + 12 < window.innerHeight - 180
              ? footnotePopup.anchor.bottom + 12
              : Math.max(16, footnotePopup.anchor.top - 180),
          }}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--stroke)]">
            <span className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wider">Footnote</span>
            <IconButton
              label="Close footnote"
              icon={<X className="w-4 h-4" />}
              size="sm"
              variant="subtle"
              onClick={() => setFootnotePopup(null)}
            />
          </div>
          <div className="text-xs leading-relaxed max-h-48 overflow-y-auto mb-3 select-text text-[var(--text-1)]">
            {footnotePopup.text}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="subtle"
              size="sm"
              className="text-xs h-7"
              onClick={() => setFootnotePopup(null)}
            >
              Dismiss
            </Button>
            <Button
              variant="accent"
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                const targetHref = footnotePopup.href
                setFootnotePopup(null)
                void viewRef.current?.goTo(targetHref)
              }}
            >
              Go to note
            </Button>
          </div>
        </div>
      )}

      {/* External Link Confirmation Modal */}
      {externalLinkPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <FocusTrap
            onClose={() => setExternalLinkPrompt(null)}
            className="w-full max-w-md p-5 rounded-2xl bg-[var(--layer-solid)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] text-[var(--text-1)]"
          >
            <div className="flex items-center gap-2 mb-3 text-[var(--accent)]">
              <ExternalLink className="w-5 h-5" />
              <h3 className="font-display font-semibold text-base">Open External Link?</h3>
            </div>
            <p className="text-xs text-[var(--text-2)] mb-3">
              You are about to open a website outside of Folio in your browser:
            </p>
            <div className="p-2.5 rounded-lg bg-[var(--layer-2)] border border-[var(--stroke)] text-xs font-mono break-all text-[var(--text-1)] mb-4">
              {externalLinkPrompt}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="subtle" size="sm" onClick={() => setExternalLinkPrompt(null)}>
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  const url = externalLinkPrompt
                  setExternalLinkPrompt(null)
                  window.open(url, '_blank', 'noopener,noreferrer')
                }}
              >
                Open Link
              </Button>
            </div>
          </FocusTrap>
        </div>
      )}

      {/* Quote Card Share Modal */}
      {quoteShareText && (
        <QuoteCardShare
          quote={quoteShareText}
          title={book?.title ?? 'Untitled'}
          author={book?.author ?? 'Unknown Author'}
          onClose={() => setQuoteShareText(null)}
        />
      )}

      {/* Keyboard Shortcuts Help Modal */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Image Pinch-to-Zoom Lightbox Modal */}
      <ImageViewerDialog
        open={!!zoomedImage}
        onOpenChange={(open) => !open && setZoomedImage(null)}
        src={zoomedImage?.src ?? ''}
        alt={zoomedImage?.alt}
      />

      {/* Mark as finished toast prompt near the end */}
      {showFinishedPrompt && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 max-w-sm w-auto animate-in fade-in slide-in-from-bottom-2 duration-[var(--d-normal)]">
          <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[var(--layer-solid)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] text-xs text-[var(--text-1)] select-none">
            <span>You&apos;re near the end. Mark as finished?</span>
            <Button
              variant="accent"
              size="sm"
              onClick={handleMarkFinished}
              className="text-xs h-7 px-2.5 shrink-0"
            >
              Mark finished
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => {
                setShowFinishedPrompt(false)
                dismissedFinishedRef.current = true
              }}
              className="text-xs h-7 px-2 shrink-0"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}