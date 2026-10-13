import { useEffect, useRef, useState } from 'react'

export interface UseSwipeTabsOptions<T extends string = string> {
  tabs: T[]
  value: T
  onChange: (value: T) => void
  containerRef?: React.RefObject<HTMLElement | null>
  disabled?: boolean
}

export class SwipeTabsController<T extends string = string> {
  private wheelAccumulator = 0
  private lastWheelTime = 0
  private wheelCooldownUntil = 0
  private wheelGestureConsumed = false

  // Touch state
  private startX = 0
  private startY = 0
  private startTime = 0
  private isSwiping: boolean | null = null // null: undecided, true: horizontal, false: vertical
  private touchOffset = 0

  private getOptions: () => {
    tabs: T[]
    value: T
    onChange: (value: T) => void
    disabled?: boolean
  }
  private onOffsetChange?: (offset: number) => void

  constructor(
    getOptions: () => {
      tabs: T[]
      value: T
      onChange: (value: T) => void
      disabled?: boolean
    },
    onOffsetChange?: (offset: number) => void,
  ) {
    this.getOptions = getOptions
    this.onOffsetChange = onOffsetChange
  }

  handleWheel = (e: WheelEvent) => {
    const { tabs, value, onChange, disabled } = this.getOptions()
    if (disabled || tabs.length <= 1) return

    // Wheel criteria per §5.3:
    // "a horizontal wheel (absolute deltaX greater than absolute deltaY) or Shift + vertical wheel over the tab bar or content switches to the adjacent tab once per gesture (threshold 80px, cooldown 350 ms). It never hijacks plain vertical scrolling of content."
    const isShiftVertical = e.shiftKey && Math.abs(e.deltaY) > 0
    const isPureHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)

    if (!isShiftVertical && !isPureHorizontal) {
      // Plain vertical scroll: DO NOT INTERCEPT, leave native vertical scroll untouched
      return
    }

    // Normalized delta value
    let rawDelta = isShiftVertical ? e.deltaY : e.deltaX
    if (e.deltaMode === 1) {
      rawDelta *= 16
    } else if (e.deltaMode === 2) {
      rawDelta *= typeof window !== 'undefined' ? window.innerWidth : 1000
    }

    const now = Date.now()
    if (now - this.lastWheelTime > 150) {
      this.wheelAccumulator = 0
      this.wheelGestureConsumed = false
    }
    this.lastWheelTime = now

    if (this.wheelGestureConsumed || now < this.wheelCooldownUntil) {
      // Gesture already switched a tab or cooldown active, prevent default horizontal scrolling
      e.preventDefault()
      return
    }

    this.wheelAccumulator += rawDelta

    if (Math.abs(this.wheelAccumulator) >= 80) {
      const currentIndex = tabs.indexOf(value)
      if (currentIndex !== -1) {
        if (this.wheelAccumulator > 0 && currentIndex < tabs.length - 1) {
          // Scroll right -> next tab
          e.preventDefault()
          onChange(tabs[currentIndex + 1])
          this.wheelAccumulator = 0
          this.wheelCooldownUntil = now + 350
          this.wheelGestureConsumed = true
        } else if (this.wheelAccumulator < 0 && currentIndex > 0) {
          // Scroll left -> prev tab
          e.preventDefault()
          onChange(tabs[currentIndex - 1])
          this.wheelAccumulator = 0
          this.wheelCooldownUntil = now + 350
          this.wheelGestureConsumed = true
        }
      }
    }
  }

  handleTouchStart = (e: TouchEvent) => {
    const { tabs, disabled } = this.getOptions()
    if (disabled || tabs.length <= 1 || e.touches.length !== 1) return
    const touch = e.touches[0]
    this.startX = touch.clientX
    this.startY = touch.clientY
    this.startTime = Date.now()
    this.isSwiping = null
    this.touchOffset = 0
    this.onOffsetChange?.(0)
  }

  handleTouchMove = (e: TouchEvent) => {
    const { tabs, value, disabled } = this.getOptions()
    if (disabled || tabs.length <= 1 || e.touches.length !== 1) return
    const touch = e.touches[0]
    const dx = touch.clientX - this.startX
    const dy = touch.clientY - this.startY

    // Decide if user is swiping horizontally or scrolling vertically
    if (this.isSwiping === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        if (Math.abs(dx) > Math.abs(dy)) {
          this.isSwiping = true
        } else {
          this.isSwiping = false
        }
      }
    }

    if (this.isSwiping === true) {
      // Prevent vertical page scroll while swiping tabs horizontally
      if (e.cancelable) e.preventDefault()

      const currentIndex = tabs.indexOf(value)
      const hasPrev = currentIndex > 0
      const hasNext = currentIndex < tabs.length - 1

      // Rubber-band resistance if swiping past ends
      let offset = dx
      if ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) {
        offset = dx * 0.3
      }
      this.touchOffset = offset
      this.onOffsetChange?.(offset)
    }
  }

  handleTouchEnd = (e: TouchEvent) => {
    const { tabs, value, onChange, disabled } = this.getOptions()
    if (disabled || tabs.length <= 1) return

    const now = Date.now()
    const elapsed = now - this.startTime
    const touch = e.changedTouches[0]
    const dx = touch ? touch.clientX - this.startX : 0
    const dy = touch ? touch.clientY - this.startY : 0

    // Per §5.3:
    // "Touch: a horizontal swipe of at least 60px within 400 ms, with vertical movement under 40px, switches tabs."
    if (this.isSwiping === true && elapsed <= 400 && Math.abs(dy) < 40 && Math.abs(dx) >= 60) {
      const currentIndex = tabs.indexOf(value)
      if (currentIndex !== -1) {
        if (dx < -60 && currentIndex < tabs.length - 1) {
          // Swiped left -> next tab
          onChange(tabs[currentIndex + 1])
        } else if (dx > 60 && currentIndex > 0) {
          // Swiped right -> prev tab
          onChange(tabs[currentIndex - 1])
        }
      }
    }

    this.isSwiping = null
    this.touchOffset = 0
    this.onOffsetChange?.(0)
  }

  handleKeyDown = (e: KeyboardEvent) => {
    const { tabs, value, onChange, disabled } = this.getOptions()
    if (disabled || tabs.length <= 1) return

    // Ctrl+Tab / Ctrl+Shift+Tab
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault()
      const currentIndex = tabs.indexOf(value)
      if (currentIndex === -1) return

      if (e.shiftKey) {
        // Prev tab (wrap around)
        const nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
        onChange(tabs[nextIndex])
      } else {
        // Next tab (wrap around)
        const nextIndex = (currentIndex + 1) % tabs.length
        onChange(tabs[nextIndex])
      }
    }
  }

  getTouchOffset() {
    return this.touchOffset
  }

  reset() {
    this.wheelAccumulator = 0
    this.lastWheelTime = 0
    this.wheelCooldownUntil = 0
    this.wheelGestureConsumed = false
    this.isSwiping = null
    this.touchOffset = 0
    this.onOffsetChange?.(0)
  }
}

export function useSwipeTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  containerRef,
  disabled,
}: UseSwipeTabsOptions<T>) {
  const [touchOffset, setTouchOffset] = useState(0)
  const optionsRef = useRef({ tabs, value, onChange, disabled })
  useEffect(() => {
    optionsRef.current = { tabs, value, onChange, disabled }
  })

  const controllerRef = useRef<SwipeTabsController<T> | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = new SwipeTabsController(
      () => optionsRef.current,
      (offset) => setTouchOffset(offset),
    )
  }

  useEffect(() => {
    const el = containerRef?.current
    if (!el) return

    const controller = controllerRef.current
    if (!controller) return

    const onWheel = (e: WheelEvent) => controller.handleWheel(e)
    const onTouchStart = (e: TouchEvent) => controller.handleTouchStart(e)
    const onTouchMove = (e: TouchEvent) => controller.handleTouchMove(e)
    const onTouchEnd = (e: TouchEvent) => controller.handleTouchEnd(e)
    const onKeyDown = (e: KeyboardEvent) => controller.handleKeyDown(e)

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('keydown', onKeyDown)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('keydown', onKeyDown)
    }
  }, [containerRef])

  return {
    touchOffset,
    controller: controllerRef.current,
    containerProps: {
      onWheel: (e: React.WheelEvent) => controllerRef.current?.handleWheel(e.nativeEvent),
      onTouchStart: (e: React.TouchEvent) => controllerRef.current?.handleTouchStart(e.nativeEvent),
      onTouchMove: (e: React.TouchEvent) => controllerRef.current?.handleTouchMove(e.nativeEvent),
      onTouchEnd: (e: React.TouchEvent) => controllerRef.current?.handleTouchEnd(e.nativeEvent),
      onKeyDown: (e: React.KeyboardEvent) => controllerRef.current?.handleKeyDown(e.nativeEvent),
    },
  }
}
