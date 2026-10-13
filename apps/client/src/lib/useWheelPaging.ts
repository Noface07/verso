import { useEffect, useRef } from 'react'
import type { FoliateView } from './foliate'
import type { ReaderSettings } from './readerSettings'

export interface WheelPagingOptions {
  view: FoliateView | null
  settings: Pick<ReaderSettings, 'flow' | 'wheelPaging' | 'wheelInvert' | 'fontSize'>
  onFontSizeChange?: (newSize: number) => void
}

export function normalizeWheel(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX
  let dy = e.deltaY
  if (e.deltaMode === 1) {
    // DOM_DELTA_LINE: typically ~16px per line
    dx *= 16
    dy *= 16
  } else if (e.deltaMode === 2) {
    // DOM_DELTA_PAGE: viewport height / width
    const vh = typeof window !== 'undefined' ? window.innerHeight || 800 : 800
    const vw = typeof window !== 'undefined' ? window.innerWidth || 1200 : 1200
    dx *= vw
    dy *= vh
  }
  return { dx, dy }
}

export class WheelPagingController {
  private accumulator = 0
  private lastEventTime = 0
  private cooldownUntil = 0
  private gestureConsumed = false
  private getOptions: () => {
    view: FoliateView | null
    settings: Pick<ReaderSettings, 'flow' | 'wheelPaging' | 'wheelInvert' | 'fontSize'>
    onFontSizeChange?: (newSize: number) => void
  }

  constructor(
    getOptions: () => {
      view: FoliateView | null
      settings: Pick<ReaderSettings, 'flow' | 'wheelPaging' | 'wheelInvert' | 'fontSize'>
      onFontSizeChange?: (newSize: number) => void
    },
  ) {
    this.getOptions = getOptions
  }

  handleWheel = (e: WheelEvent) => {
    const { view, settings, onFontSizeChange } = this.getOptions()

    // Ctrl + wheel: font size step ±1 (clamped 12–36), prevents browser zoom
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (onFontSizeChange) {
        const step = e.deltaY < 0 ? 1 : -1
        const next = Math.min(36, Math.max(12, settings.fontSize + step))
        if (next !== settings.fontSize) {
          onFontSizeChange(next)
        }
      }
      return
    }

    // Scrolled mode: native scrolling, no interception
    if (settings.flow !== 'paginated') {
      return
    }

    // If wheel paging is disabled, leave native behavior
    if (!settings.wheelPaging) {
      return
    }

    // Paginated mode: prevent default scrolling / bouncing
    e.preventDefault()

    if (!view) return

    const now = Date.now()

    // Trackpad inertia / gesture gap: treat a gap of > 120 ms as a new gesture
    if (now - this.lastEventTime > 120) {
      this.accumulator = 0
      this.gestureConsumed = false
    }
    this.lastEventTime = now

    // If the current gesture has already turned a page, ignore trailing inertia events
    if (this.gestureConsumed) {
      return
    }

    // During cooldown period (280 ms), ignore events
    if (now < this.cooldownUntil) {
      return
    }

    const { dx, dy } = normalizeWheel(e)
    const effectiveDelta = (settings.wheelInvert ? -1 : 1) * (dy + dx)

    this.accumulator += effectiveDelta

    if (Math.abs(this.accumulator) >= 60) {
      if (this.accumulator > 0) {
        view.goRight()
      } else {
        view.goLeft()
      }
      this.accumulator = 0
      this.cooldownUntil = now + 280
      this.gestureConsumed = true
    }
  }

  reset() {
    this.accumulator = 0
    this.lastEventTime = 0
    this.cooldownUntil = 0
    this.gestureConsumed = false
  }
}

export function useWheelPaging({ view, settings, onFontSizeChange }: WheelPagingOptions) {
  const optionsRef = useRef({ view, settings, onFontSizeChange })
  useEffect(() => {
    optionsRef.current = { view, settings, onFontSizeChange }
  })

  const controllerRef = useRef<WheelPagingController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new WheelPagingController(() => optionsRef.current)
  }

  const attachedDocsRef = useRef(new Set<Document>())

  // Attach to window
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return

    const handleWheel = controller.handleWheel
    window.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      window.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Listen to foliate-view 'load' event to attach to each loaded section document
  useEffect(() => {
    if (!view) return
    const controller = controllerRef.current
    if (!controller) return

    const handleWheel = controller.handleWheel
    const docs = attachedDocsRef.current

    const attachDoc = (doc: Document) => {
      if (docs.has(doc)) return
      docs.add(doc)
      doc.addEventListener('wheel', handleWheel, { passive: false })
    }

    const onLoad = (e: Event) => {
      const detail = (e as CustomEvent).detail as { doc?: Document } | undefined
      if (detail?.doc) {
        attachDoc(detail.doc)
      }
    }

    view.addEventListener('load', onLoad)

    return () => {
      view.removeEventListener('load', onLoad)
      for (const doc of docs) {
        doc.removeEventListener('wheel', handleWheel)
      }
      docs.clear()
    }
  }, [view])

  return {
    attachDocument: (doc: Document) => {
      const controller = controllerRef.current
      if (controller && !attachedDocsRef.current.has(doc)) {
        attachedDocsRef.current.add(doc)
        doc.addEventListener('wheel', controller.handleWheel, { passive: false })
      }
    },
  }
}
