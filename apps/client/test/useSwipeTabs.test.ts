import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SwipeTabsController } from '../src/lib/useSwipeTabs'

describe('useSwipeTabs & SwipeTabsController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const tabs = ['books', 'manga', 'comics']

  function createWheelEvent(opts: {
    deltaX?: number
    deltaY?: number
    shiftKey?: boolean
    deltaMode?: number
  }): WheelEvent {
    let prevented = false
    return {
      deltaX: opts.deltaX ?? 0,
      deltaY: opts.deltaY ?? 0,
      shiftKey: opts.shiftKey ?? false,
      deltaMode: opts.deltaMode ?? 0,
      preventDefault: () => {
        prevented = true
      },
      get defaultPrevented() {
        return prevented
      },
    } as unknown as WheelEvent
  }

  function createTouchEvent(
    type: 'touchstart' | 'touchmove' | 'touchend',
    touches: Array<{ clientX: number; clientY: number }>,
    changedTouches?: Array<{ clientX: number; clientY: number }>,
  ): TouchEvent {
    let prevented = false
    return {
      type,
      cancelable: true,
      touches,
      changedTouches: changedTouches ?? touches,
      preventDefault: () => {
        prevented = true
      },
      get defaultPrevented() {
        return prevented
      },
    } as unknown as TouchEvent
  }

  describe('Wheel navigation', () => {
    it('Shift+wheel over tabs switches tabs and prevents horizontal scrolling', () => {
      let current = 'books'
      const onChange = vi.fn((next: string) => {
        current = next
      })

      const controller = new SwipeTabsController(() => ({
        tabs,
        value: current,
        onChange,
      }))

      // Shift + wheel down (positive deltaY = 100) -> switches to 'manga'
      const event1 = createWheelEvent({ deltaY: 100, shiftKey: true })
      controller.handleWheel(event1)

      expect(event1.defaultPrevented).toBe(true)
      expect(onChange).toHaveBeenCalledWith('manga')

      // Cooldown (350ms): rapid events within cooldown do not trigger next tab switch
      vi.advanceTimersByTime(100)
      const event2 = createWheelEvent({ deltaY: 100, shiftKey: true })
      controller.handleWheel(event2)
      expect(onChange).toHaveBeenCalledTimes(1)

      // After cooldown and gesture gap, Shift+wheel down switches to 'comics'
      vi.advanceTimersByTime(350)
      const event3 = createWheelEvent({ deltaY: 100, shiftKey: true })
      controller.handleWheel(event3)
      expect(onChange).toHaveBeenCalledWith('comics')
    })

    it('plain vertical wheel scrolls content and NEVER switches tabs', () => {
      const onChange = vi.fn()
      const controller = new SwipeTabsController(() => ({
        tabs,
        value: 'books',
        onChange,
      }))

      // Pure vertical scroll (deltaY = 120, deltaX = 0, no Shift)
      const verticalEvent = createWheelEvent({ deltaY: 120, deltaX: 0 })
      controller.handleWheel(verticalEvent)

      expect(verticalEvent.defaultPrevented).toBe(false)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('horizontal wheel (deltaX > deltaY) switches tabs', () => {
      let current = 'manga'
      const onChange = vi.fn((next: string) => {
        current = next
      })

      const controller = new SwipeTabsController(() => ({
        tabs,
        value: current,
        onChange,
      }))

      // Scroll left (deltaX = -90) -> switches to 'books'
      const event = createWheelEvent({ deltaX: -90, deltaY: 0 })
      controller.handleWheel(event)

      expect(event.defaultPrevented).toBe(true)
      expect(onChange).toHaveBeenCalledWith('books')
    })
  })

  describe('Touch swipe navigation', () => {
    it('horizontal swipe >= 60px in <= 400ms with vertical < 40px switches tabs', () => {
      let current = 'books'
      const onChange = vi.fn((next: string) => {
        current = next
      })

      const controller = new SwipeTabsController(() => ({
        tabs,
        value: current,
        onChange,
      }))

      // Touch start at (100, 200)
      controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 100, clientY: 200 }]))

      // Swipe left to (20, 210): dx = -80, dy = +10 (time elapsed 100ms)
      vi.advanceTimersByTime(100)
      controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 20, clientY: 210 }]))

      // Touch end
      controller.handleTouchEnd(
        createTouchEvent('touchend', [], [{ clientX: 20, clientY: 210 }]),
      )

      expect(onChange).toHaveBeenCalledWith('manga')
    })

    it('diagonal touch that is mostly vertical does NOT switch tabs', () => {
      const onChange = vi.fn()
      const controller = new SwipeTabsController(() => ({
        tabs,
        value: 'books',
        onChange,
      }))

      // Touch start at (100, 200)
      controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 100, clientY: 200 }]))

      // Move mostly vertically: dx = 20, dy = 100
      vi.advanceTimersByTime(100)
      controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 120, clientY: 300 }]))

      controller.handleTouchEnd(
        createTouchEvent('touchend', [], [{ clientX: 120, clientY: 300 }]),
      )

      expect(onChange).not.toHaveBeenCalled()
    })

    it('rubber-band resistance is applied when swiping past the boundaries', () => {
      let offset = 0
      const controller = new SwipeTabsController(
        () => ({
          tabs,
          value: 'books', // first tab, cannot swipe right
          onChange: vi.fn(),
        }),
        (o) => {
          offset = o
        },
      )

      controller.handleTouchStart(createTouchEvent('touchstart', [{ clientX: 100, clientY: 200 }]))

      // Swipe right dx = +50 on first tab
      controller.handleTouchMove(createTouchEvent('touchmove', [{ clientX: 150, clientY: 200 }]))

      // Rubber-band resistance (50 * 0.3 = 15)
      expect(offset).toBeCloseTo(15)
    })
  })

  describe('Keyboard navigation', () => {
    it('Ctrl+Tab switches to the next tab with wraparound', () => {
      let current = 'comics' // last tab
      const onChange = vi.fn((next: string) => {
        current = next
      })

      const controller = new SwipeTabsController(() => ({
        tabs,
        value: current,
        onChange,
      }))

      let prevented = false
      const event = {
        key: 'Tab',
        ctrlKey: true,
        shiftKey: false,
        preventDefault: () => {
          prevented = true
        },
      } as unknown as KeyboardEvent

      controller.handleKeyDown(event)

      expect(prevented).toBe(true)
      expect(onChange).toHaveBeenCalledWith('books') // wrapped around to first tab
    })

    it('Ctrl+Shift+Tab switches to the previous tab with wraparound', () => {
      let current = 'books' // first tab
      const onChange = vi.fn((next: string) => {
        current = next
      })

      const controller = new SwipeTabsController(() => ({
        tabs,
        value: current,
        onChange,
      }))

      let prevented = false
      const event = {
        key: 'Tab',
        ctrlKey: true,
        shiftKey: true,
        preventDefault: () => {
          prevented = true
        },
      } as unknown as KeyboardEvent

      controller.handleKeyDown(event)

      expect(prevented).toBe(true)
      expect(onChange).toHaveBeenCalledWith('comics') // wrapped around to last tab
    })
  })
})
