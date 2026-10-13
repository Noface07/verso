import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HotkeysController,
  SHORTCUTS_REGISTRY,
  isInputTarget,
} from '../src/lib/useHotkeys'

describe('useHotkeys & HotkeysController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createKeyEvent(opts: {
    key: string
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    target?: EventTarget
  }): KeyboardEvent {
    let prevented = false
    return {
      key: opts.key,
      ctrlKey: opts.ctrlKey ?? false,
      metaKey: opts.metaKey ?? false,
      shiftKey: opts.shiftKey ?? false,
      altKey: opts.altKey ?? false,
      target: opts.target ?? document.body,
      preventDefault: () => {
        prevented = true
      },
      get defaultPrevented() {
        return prevented
      },
    } as unknown as KeyboardEvent
  }

  it('contains every §5.4 shortcut in SHORTCUTS_REGISTRY', () => {
    const ids = SHORTCUTS_REGISTRY.map((s) => s.id)
    expect(ids).toContain('search')
    expect(ids).toContain('search-slash')
    expect(ids).toContain('import')
    expect(ids).toContain('settings')
    expect(ids).toContain('go-home')
    expect(ids).toContain('go-library')
    expect(ids).toContain('go-notebook')
    expect(ids).toContain('go-store')
    expect(ids).toContain('help')
    expect(ids).toContain('esc')
    expect(ids).toContain('nav-pages')
    expect(ids).toContain('toc')
    expect(ids).toContain('bookmark')
    expect(ids).toContain('highlights')
    expect(ids).toContain('fullscreen')
    expect(ids).toContain('search-book')
    expect(ids).toContain('read-aloud')
    expect(ids).toContain('font-increase')
    expect(ids).toContain('font-decrease')
  })

  it('triggers onSearch on Ctrl+K and /', () => {
    const onSearch = vi.fn()
    const controller = new HotkeysController(() => ({ onSearch }))

    const ctrlK = createKeyEvent({ key: 'k', ctrlKey: true })
    controller.handleKeyDown(ctrlK)
    expect(ctrlK.defaultPrevented).toBe(true)
    expect(onSearch).toHaveBeenCalledTimes(1)

    const slash = createKeyEvent({ key: '/' })
    controller.handleKeyDown(slash)
    expect(slash.defaultPrevented).toBe(true)
    expect(onSearch).toHaveBeenCalledTimes(2)
  })

  it('suppresses regular shortcuts when typing in an input or textarea', () => {
    const onSearch = vi.fn()
    const onImport = vi.fn()
    const onSettings = vi.fn()
    const controller = new HotkeysController(() => ({ onSearch, onImport, onSettings }))

    const input = document.createElement('input')
    expect(isInputTarget(input)).toBe(true)

    const slashInInput = createKeyEvent({ key: '/', target: input })
    controller.handleKeyDown(slashInInput)
    expect(onSearch).not.toHaveBeenCalled()

    const importInInput = createKeyEvent({ key: 'o', ctrlKey: true, target: input })
    controller.handleKeyDown(importInInput)
    expect(onImport).not.toHaveBeenCalled()
  })

  it('triggers onImport on Ctrl+O', () => {
    const onImport = vi.fn()
    const controller = new HotkeysController(() => ({ onImport }))

    const ctrlO = createKeyEvent({ key: 'o', ctrlKey: true })
    controller.handleKeyDown(ctrlO)
    expect(ctrlO.defaultPrevented).toBe(true)
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it('triggers onSettings on Ctrl+,', () => {
    const onSettings = vi.fn()
    const controller = new HotkeysController(() => ({ onSettings }))

    const ctrlComma = createKeyEvent({ key: ',', ctrlKey: true })
    controller.handleKeyDown(ctrlComma)
    expect(ctrlComma.defaultPrevented).toBe(true)
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  it('triggers onHelp on ? or Shift+/', () => {
    const onHelp = vi.fn()
    const controller = new HotkeysController(() => ({ onHelp }))

    const question = createKeyEvent({ key: '?' })
    controller.handleKeyDown(question)
    expect(question.defaultPrevented).toBe(true)
    expect(onHelp).toHaveBeenCalledTimes(1)

    const shiftSlash = createKeyEvent({ key: '/', shiftKey: true })
    controller.handleKeyDown(shiftSlash)
    expect(shiftSlash.defaultPrevented).toBe(true)
    expect(onHelp).toHaveBeenCalledTimes(2)
  })

  it('handles two-key navigation sequence: G then H/L/N/S', () => {
    const onNavigate = vi.fn()
    const controller = new HotkeysController(() => ({ onNavigate }))

    // Press 'G' then 'H'
    controller.handleKeyDown(createKeyEvent({ key: 'g' }))
    const pressH = createKeyEvent({ key: 'h' })
    controller.handleKeyDown(pressH)
    expect(pressH.defaultPrevented).toBe(true)
    expect(onNavigate).toHaveBeenCalledWith('/')

    // Press 'G' then 'L'
    controller.handleKeyDown(createKeyEvent({ key: 'g' }))
    const pressL = createKeyEvent({ key: 'l' })
    controller.handleKeyDown(pressL)
    expect(onNavigate).toHaveBeenCalledWith('/library')

    // Press 'G' then 'N'
    controller.handleKeyDown(createKeyEvent({ key: 'g' }))
    const pressN = createKeyEvent({ key: 'n' })
    controller.handleKeyDown(pressN)
    expect(onNavigate).toHaveBeenCalledWith('/notebook')

    // Press 'G' then 'S'
    controller.handleKeyDown(createKeyEvent({ key: 'g' }))
    const pressS = createKeyEvent({ key: 's' })
    controller.handleKeyDown(pressS)
    expect(onNavigate).toHaveBeenCalledWith('/store')
  })

  it('resets two-key sequence if timeout exceeds 1000ms', () => {
    const onNavigate = vi.fn()
    const controller = new HotkeysController(() => ({ onNavigate }))

    // Press 'G'
    controller.handleKeyDown(createKeyEvent({ key: 'g' }))

    // Wait 1200ms
    vi.advanceTimersByTime(1200)

    // Press 'H' (sequence expired, should not navigate)
    controller.handleKeyDown(createKeyEvent({ key: 'h' }))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('Escape always triggers onEscape even inside an input', () => {
    const onEscape = vi.fn()
    const controller = new HotkeysController(() => ({ onEscape }))

    const input = document.createElement('textarea')
    const escEvent = createKeyEvent({ key: 'Escape', target: input })
    controller.handleKeyDown(escEvent)

    expect(escEvent.defaultPrevented).toBe(true)
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})
