import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WheelPagingController, normalizeWheel } from '../src/lib/useWheelPaging'
import type { FoliateView } from '../src/lib/foliate'

describe('useWheelPaging & WheelPagingController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createMockEvent(opts: {
    deltaX?: number
    deltaY?: number
    deltaMode?: number
    ctrlKey?: boolean
    metaKey?: boolean
  }): WheelEvent {
    let prevented = false
    return {
      deltaX: opts.deltaX ?? 0,
      deltaY: opts.deltaY ?? 0,
      deltaMode: opts.deltaMode ?? 0,
      ctrlKey: opts.ctrlKey ?? false,
      metaKey: opts.metaKey ?? false,
      preventDefault: () => {
        prevented = true
      },
      get defaultPrevented() {
        return prevented
      },
    } as unknown as WheelEvent
  }

  it('normalizes deltaMode correctly', () => {
    // Mode 0: pixels
    expect(normalizeWheel({ deltaX: 10, deltaY: 20, deltaMode: 0 } as WheelEvent)).toEqual({
      dx: 10,
      dy: 20,
    })
    // Mode 1: lines (16px per line)
    expect(normalizeWheel({ deltaX: 2, deltaY: 3, deltaMode: 1 } as WheelEvent)).toEqual({
      dx: 32,
      dy: 48,
    })
  })

  it('one mouse wheel notch turns one page and prevents browser scroll', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new WheelPagingController(() => ({
      view: mockView,
      settings: {
        flow: 'paginated',
        wheelPaging: true,
        wheelInvert: false,
        fontSize: 18,
      },
    }))

    // First notch forward: deltaY = 100px
    const event1 = createMockEvent({ deltaY: 100 })
    controller.handleWheel(event1)

    expect(event1.defaultPrevented).toBe(true)
    expect(mockView.goRight).toHaveBeenCalledTimes(1)
    expect(mockView.goLeft).not.toHaveBeenCalled()

    // Immediate micro-events within the 280ms cooldown do not trigger a second page turn
    vi.advanceTimersByTime(50)
    const event2 = createMockEvent({ deltaY: 100 })
    controller.handleWheel(event2)
    expect(mockView.goRight).toHaveBeenCalledTimes(1)

    // After gesture completes (gap > 120ms and cooldown > 280ms passed), next notch turns next page
    vi.advanceTimersByTime(300)
    const event3 = createMockEvent({ deltaY: 100 })
    controller.handleWheel(event3)
    expect(mockView.goRight).toHaveBeenCalledTimes(2)
  })

  it('trackpad fast flick turns exactly one page despite trailing inertia', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new WheelPagingController(() => ({
      view: mockView,
      settings: {
        flow: 'paginated',
        wheelPaging: true,
        wheelInvert: false,
        fontSize: 18,
      },
    }))

    // Fast flick stream: events arriving every 16ms
    controller.handleWheel(createMockEvent({ deltaY: 30 }))
    vi.advanceTimersByTime(16)
    controller.handleWheel(createMockEvent({ deltaY: 40 })) // Sum = 70px -> triggers page turn!
    expect(mockView.goRight).toHaveBeenCalledTimes(1)

    // Trailing inertia events continue arriving with <= 120ms gaps for next 400ms
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(20)
      controller.handleWheel(createMockEvent({ deltaY: 25 }))
    }

    // Still exactly 1 page turned!
    expect(mockView.goRight).toHaveBeenCalledTimes(1)

    // Once flick stops and gap > 120ms occurs, a new gesture can turn a page
    vi.advanceTimersByTime(150)
    controller.handleWheel(createMockEvent({ deltaY: 70 }))
    expect(mockView.goRight).toHaveBeenCalledTimes(2)
  })

  it('scrolling backward turns to the left / previous page', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new WheelPagingController(() => ({
      view: mockView,
      settings: {
        flow: 'paginated',
        wheelPaging: true,
        wheelInvert: false,
        fontSize: 18,
      },
    }))

    const event = createMockEvent({ deltaY: -80 })
    controller.handleWheel(event)

    expect(mockView.goLeft).toHaveBeenCalledTimes(1)
    expect(mockView.goRight).not.toHaveBeenCalled()
  })

  it('inverting direction inverts page turn', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    const controller = new WheelPagingController(() => ({
      view: mockView,
      settings: {
        flow: 'paginated',
        wheelPaging: true,
        wheelInvert: true,
        fontSize: 18,
      },
    }))

    const event = createMockEvent({ deltaY: 80 })
    controller.handleWheel(event)

    // With invert true, positive delta turns left instead of right
    expect(mockView.goLeft).toHaveBeenCalledTimes(1)
    expect(mockView.goRight).not.toHaveBeenCalled()
  })

  it('Ctrl + wheel steps font size and prevents browser zoom', () => {
    const onFontSizeChange = vi.fn()
    let currentFontSize = 18

    const controller = new WheelPagingController(() => ({
      view: null,
      settings: {
        flow: 'paginated',
        wheelPaging: true,
        wheelInvert: false,
        fontSize: currentFontSize,
      },
      onFontSizeChange: (s) => {
        currentFontSize = s
        onFontSizeChange(s)
      },
    }))

    // Ctrl + scroll up (deltaY < 0): zoom in
    const zoomInEvent = createMockEvent({ deltaY: -50, ctrlKey: true })
    controller.handleWheel(zoomInEvent)

    expect(zoomInEvent.defaultPrevented).toBe(true)
    expect(onFontSizeChange).toHaveBeenCalledWith(19)

    // Ctrl + scroll down (deltaY > 0): zoom out
    const zoomOutEvent = createMockEvent({ deltaY: 50, ctrlKey: true })
    controller.handleWheel(zoomOutEvent)

    expect(zoomOutEvent.defaultPrevented).toBe(true)
    expect(onFontSizeChange).toHaveBeenCalledWith(18)
  })

  it('does not intercept when flow is scrolled or wheelPaging is false', () => {
    const mockView = {
      goRight: vi.fn(),
      goLeft: vi.fn(),
    } as unknown as FoliateView

    // Scrolled mode
    const scrolledController = new WheelPagingController(() => ({
      view: mockView,
      settings: {
        flow: 'scrolled',
        wheelPaging: true,
        wheelInvert: false,
        fontSize: 18,
      },
    }))

    const scrollEvent = createMockEvent({ deltaY: 100 })
    scrolledController.handleWheel(scrollEvent)
    expect(scrollEvent.defaultPrevented).toBe(false)
    expect(mockView.goRight).not.toHaveBeenCalled()

    // Wheel paging disabled
    const disabledController = new WheelPagingController(() => ({
      view: mockView,
      settings: {
        flow: 'paginated',
        wheelPaging: false,
        wheelInvert: false,
        fontSize: 18,
      },
    }))

    const disabledEvent = createMockEvent({ deltaY: 100 })
    disabledController.handleWheel(disabledEvent)
    expect(disabledEvent.defaultPrevented).toBe(false)
    expect(mockView.goRight).not.toHaveBeenCalled()
  })
})
