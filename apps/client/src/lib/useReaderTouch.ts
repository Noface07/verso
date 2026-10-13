import { useEffect, useRef } from 'react'
import type { FoliateView } from './foliate'

export interface UseReaderTouchOptions {
  view: FoliateView | null
  flow: 'paginated' | 'scrolled'
  onImageZoom?: (src: string, alt?: string) => void
}

export function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.hypot(dx, dy)
}

export class ReaderTouchController {
  private startX = 0
  private startY = 0
  private startTime = 0
  private initialPinchDist = 0
  private pinchTargetImg: HTMLImageElement | null = null
  private isSwiping = false

  private getOptions: () => {
    view: FoliateView | null
    flow: 'paginated' | 'scrolled'
    onImageZoom?: (src: string, alt?: string) => void
  }

  constructor(
    getOptions: () => {
      view: FoliateView | null
      flow: 'paginated' | 'scrolled'
      onImageZoom?: (src: string, alt?: string) => void
    },
  ) {
    this.getOptions = getOptions
  }

  handleTouchStart = (e: TouchEvent) => {
    const { onImageZoom } = this.getOptions()
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      this.startX = touch.clientX
      this.startY = touch.clientY
      this.startTime = Date.now()
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
      const dx = touch.clientX - this.startX
      const dy = touch.clientY - this.startY
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        this.isSwiping = true
      }
    }
  }

  handleTouchEnd = (e: TouchEvent) => {
    const { view, flow } = this.getOptions()
    if (flow !== 'paginated' || !view) {
      this.isSwiping = false
      return
    }

    const elapsed = Date.now() - this.startTime
    const touch = e.changedTouches[0]
    if (!touch) return

    const dx = touch.clientX - this.startX
    const dy = touch.clientY - this.startY

    // Per §6 P2.5: Horizontal swipe of at least 60px in <= 400ms turns pages
    if (this.isSwiping && elapsed <= 400 && Math.abs(dy) < 50 && Math.abs(dx) >= 60) {
      if (dx < -60) {
        view.goRight()
      } else if (dx > 60) {
        view.goLeft()
      }
    }

    this.isSwiping = false
    this.initialPinchDist = 0
    this.pinchTargetImg = null
  }
}

export function useReaderTouch({ view, flow, onImageZoom }: UseReaderTouchOptions) {
  const optionsRef = useRef({ view, flow, onImageZoom })
  useEffect(() => {
    optionsRef.current = { view, flow, onImageZoom }
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
