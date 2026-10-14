import { useEffect, useRef } from 'react'
import type { FoliateView } from './foliate'

export interface UseReaderTouchOptions {
  view: FoliateView | null
  flow: 'paginated' | 'scrolled'
  onImageZoom?: (src: string, alt?: string) => void
  /** Current CFI, so a swipe can tell whether foliate already turned the page. */
  getLocation?: () => string | undefined
}

export function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.hypot(dx, dy)
}

const hasSelection = (e: TouchEvent): boolean => {
  const sel = (e.target as Node | null)?.ownerDocument?.getSelection()
  return !!sel && !sel.isCollapsed
}

export class ReaderTouchController {
  private startX = 0
  private startY = 0
  private startTime = 0
  private startLocation: string | undefined
  private selecting = false
  private pendingTurn: number | undefined
  private initialPinchDist = 0
  private pinchTargetImg: HTMLImageElement | null = null
  private isSwiping = false

  private getOptions: () => UseReaderTouchOptions

  constructor(getOptions: () => UseReaderTouchOptions) {
    this.getOptions = getOptions
  }

  handleTouchStart = (e: TouchEvent) => {
    const { onImageZoom, getLocation } = this.getOptions()
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      // screenX/Y, not clientX/Y: foliate drags the page along with the finger, so
      // the finger barely moves relative to the book's iframe and clientX deltas stay ~0.
      this.startX = touch.screenX
      this.startY = touch.screenY
      this.startTime = Date.now()
      this.startLocation = getLocation?.()
      this.selecting = hasSelection(e)
      this.isSwiping = false
      this.initialPinchDist = 0
      this.pinchTargetImg = null
    } else if (e.touches.length === 2 && onImageZoom) {
      const target = (e.target as HTMLElement | null)?.closest?.('img') ?? null
      if (target instanceof HTMLImageElement && target.src) {
        this.pinchTargetImg = target
        this.initialPinchDist = getTouchDistance(e.touches[0], e.touches[1])
      }
    }
  }

  handleTouchMove = (e: TouchEvent) => {
    const { onImageZoom } = this.getOptions()
    if (e.touches.length === 2 && this.pinchTargetImg && this.initialPinchDist > 0 && onImageZoom) {
      const currentDist = getTouchDistance(e.touches[0], e.touches[1])
      if (currentDist / this.initialPinchDist > 1.25) {
        if (e.cancelable) e.preventDefault()
        const img = this.pinchTargetImg
        this.initialPinchDist = 0
        this.pinchTargetImg = null
        onImageZoom(img.src, img.alt || '')
      }
      return
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0]
      const dx = touch.screenX - this.startX
      const dy = touch.screenY - this.startY
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        this.isSwiping = true
      }
    }
  }

  handleTouchEnd = (e: TouchEvent) => {
    const { view, flow } = this.getOptions()
    const touch = e.changedTouches[0]
    const swiping = this.isSwiping
    this.isSwiping = false
    this.initialPinchDist = 0
    this.pinchTargetImg = null
    if (flow !== 'paginated' || !view || !touch || !swiping) return
    if (this.selecting || hasSelection(e) || e.touches.length > 0) return

    const dx = touch.screenX - this.startX
    const dy = touch.screenY - this.startY
    if (Date.now() - this.startTime > 500 || Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.6) return

    const before = this.startLocation
    const forward = dx < 0
    window.clearTimeout(this.pendingTurn)
    // Give foliate's own drag-and-snap a moment; turn only if it didn't move the page.
    this.pendingTurn = window.setTimeout(() => {
      const { view: v, getLocation } = this.getOptions()
      if (!v || (getLocation && getLocation() !== before)) return
      if (forward) v.goRight()
      else v.goLeft()
    }, 450)
  }
}

export function useReaderTouch({ view, flow, onImageZoom, getLocation }: UseReaderTouchOptions) {
  const optionsRef = useRef<UseReaderTouchOptions>({ view, flow, onImageZoom, getLocation })
  useEffect(() => {
    optionsRef.current = { view, flow, onImageZoom, getLocation }
  })

  const controllerRef = useRef<ReaderTouchController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new ReaderTouchController(() => optionsRef.current)
  }

  const attachedDocsRef = useRef(new Set<Document>())

  // Attach touch listeners to document
  const attachDocument = (doc: Document) => {
    const controller = controllerRef.current
    if (!controller || attachedDocsRef.current.has(doc)) return
    attachedDocsRef.current.add(doc)

    doc.addEventListener('touchstart', controller.handleTouchStart, { passive: true })
    doc.addEventListener('touchmove', controller.handleTouchMove, { passive: false })
    doc.addEventListener('touchend', controller.handleTouchEnd, { passive: true })

    // Also support double-click / tap on images to open zoom modal
    doc.addEventListener('dblclick', (e) => {
      const target = (e.target as HTMLElement | null)?.closest?.('img')
      if (target instanceof HTMLImageElement && target.src && optionsRef.current.onImageZoom) {
        optionsRef.current.onImageZoom(target.src, target.alt || '')
      }
    })
  }

  useEffect(() => {
    if (!view) return
    const controller = controllerRef.current
    if (!controller) return

    const docs = attachedDocsRef.current
    const onLoad = (e: Event) => {
      const detail = (e as CustomEvent).detail as { doc?: Document } | undefined
      if (detail?.doc) {
        attachDocument(detail.doc)
      }
    }

    view.addEventListener('load', onLoad)

    return () => {
      view.removeEventListener('load', onLoad)
      for (const doc of docs) {
        doc.removeEventListener('touchstart', controller.handleTouchStart)
        doc.removeEventListener('touchmove', controller.handleTouchMove)
        doc.removeEventListener('touchend', controller.handleTouchEnd)
      }
      docs.clear()
    }
  }, [view])

  return {
    attachDocument,
  }
}
