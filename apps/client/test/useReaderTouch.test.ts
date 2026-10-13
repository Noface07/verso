import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReaderTouchController, getTouchDistance } from '../src/lib/useReaderTouch'
import type { FoliateView } from '../src/lib/foliate'

describe('useReaderTouch & ReaderTouchController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createTouchEvent(
    type: 'touchstart' | 'touchmove' | 'touchend',
    touches: Array<{ clientX: number; clientY: number; target?: EventTarget }>,
    changedTouches?: Array<{ clientX: number; clientY: number }>,
  ): TouchEvent {
    let prevented = false
    const touchList = touches.map((t) => ({
      clientX: t.clientX,
      clientY: t.clientY,
      target: t.target ?? document.body,
    }))
    const changedTouchList = (changedTouches ?? touches).map((t) => ({
      clientX: t.clientX,
      clientY: t.clientY,
      target: document.body,
    }))
    return {
      type,
      cancelable: true,
      touches: touchList,
      changedTouches: changedTouchList,
      target: touchList[0]?.target ?? document.body,
      preventDefault: () => {
        prevented = true
      },
      get defaultPrevented() {
        return prevented
      },
    } as unknown as TouchEvent
  }

  it('calculates touch distance correctly', () => {
    const t1 = { clientX: 0, clientY: 0 } as Touch
    const t2 = { clientX: 30, clientY: 40 } as Touch
    expect(getTouchDistance(t1, t2)).toBe(50)
  })

  it('turns to next page on horizontal swipe left', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new ReaderTouchController(() => ({
      view: mockView,
      flow: 'paginated',
    }))

    // Touch start at (200, 300)
    controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 200, clientY: 300 }]))

    // Swipe left to (120, 305): dx = -80, dy = +5
    vi.advanceTimersByTime(120)
    controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 120, clientY: 305 }]))
    controller.handleTouchEnd(
      createTouchEvent('touchend', [], [{ clientX: 120, clientY: 305 }]),
    )

    expect(mockView.goRight).toHaveBeenCalledTimes(1)
    expect(mockView.goLeft).not.toHaveBeenCalled()
  })

  it('turns to previous page on horizontal swipe right', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new ReaderTouchController(() => ({
      view: mockView,
      flow: 'paginated',
    }))

    controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 100, clientY: 300 }]))

    vi.advanceTimersByTime(150)
    controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 180, clientY: 310 }]))
    controller.handleTouchEnd(
      createTouchEvent('touchend', [], [{ clientX: 180, clientY: 310 }]),
    )

    expect(mockView.goLeft).toHaveBeenCalledTimes(1)
    expect(mockView.goRight).not.toHaveBeenCalled()
  })

  it('does not turn page on mostly vertical swipe or slow drag', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new ReaderTouchController(() => ({
      view: mockView,
      flow: 'paginated',
    }))

    // Mostly vertical scroll
    controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    vi.advanceTimersByTime(100)
    controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 110, clientY: 250 }]))
    controller.handleTouchEnd(
      createTouchEvent('touchend', [], [{ clientX: 110, clientY: 250 }]),
    )
    expect(mockView.goRight).not.toHaveBeenCalled()
    expect(mockView.goLeft).not.toHaveBeenCalled()

    // Slow drag (> 400ms)
    controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 200, clientY: 200 }]))
    vi.advanceTimersByTime(500)
    controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 100, clientY: 205 }]))
    controller.handleTouchEnd(
      createTouchEvent('touchend', [], [{ clientX: 100, clientY: 205 }]),
    )
    expect(mockView.goRight).not.toHaveBeenCalled()
  })

  it('triggers onImageZoom on two-finger pinch gesture on an image', () => {
    const onImageZoom = vi.fn()
    const controller = new ReaderTouchController(() => ({
      view: null,
      flow: 'paginated',
      onImageZoom,
    }))

    const img = document.createElement('img')
    img.src = 'blob:http://localhost/test-image.jpg'
    img.alt = 'Illustration'

    // Pinch start: fingers 50px apart
    controller.handleTouchStart(
      createTouchEvent('touchstart', [
        { clientX: 100, clientY: 100, target: img },
        { clientX: 150, clientY: 100, target: img },
      ]),
    )

    // Pinch spread: fingers move to 80px apart (dist ratio = 80/50 = 1.6 > 1.25)
    controller.handleTouchMove(
      createTouchEvent('touchmove', [
        { clientX: 90, clientY: 100, target: img },
        { clientX: 170, clientY: 100, target: img },
      ]),
    )

    expect(onImageZoom).toHaveBeenCalledWith('blob:http://localhost/test-image.jpg', 'Illustration')
  })
})
