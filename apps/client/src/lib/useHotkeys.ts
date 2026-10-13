import { useEffect, useRef } from 'react'

export interface ShortcutItem {
  id: string
  keys: string[]
  label: string
  scope: 'global' | 'reader'
}

export const SHORTCUTS_REGISTRY: ShortcutItem[] = [
  // Global
  { id: 'search', keys: ['Ctrl', 'K'], label: 'Focus search', scope: 'global' },
  { id: 'search-slash', keys: ['/'], label: 'Focus search', scope: 'global' },
  { id: 'import', keys: ['Ctrl', 'O'], label: 'Add books', scope: 'global' },
  { id: 'settings', keys: ['Ctrl', ','], label: 'Settings', scope: 'global' },
  { id: 'go-home', keys: ['G', 'then', 'H'], label: 'Go to Home', scope: 'global' },
  { id: 'go-library', keys: ['G', 'then', 'L'], label: 'Go to Library', scope: 'global' },
  { id: 'go-notebook', keys: ['G', 'then', 'N'], label: 'Go to Notebook', scope: 'global' },
  { id: 'go-store', keys: ['G', 'then', 'S'], label: 'Go to Store', scope: 'global' },
  { id: 'help', keys: ['?'], label: 'Keyboard shortcuts help', scope: 'global' },
  { id: 'esc', keys: ['Esc'], label: 'Close topmost layer', scope: 'global' },

  // Reader
  { id: 'nav-pages', keys: ['←', '→', 'PgUp', 'PgDn', 'Space'], label: 'Page navigation', scope: 'reader' },
  { id: 'toc', keys: ['T'], label: 'Table of contents', scope: 'reader' },
  { id: 'bookmark', keys: ['B'], label: 'Toggle bookmark', scope: 'reader' },
  { id: 'highlights', keys: ['H'], label: 'Highlights & notes panel', scope: 'reader' },
  { id: 'fullscreen', keys: ['F'], label: 'Toggle fullscreen', scope: 'reader' },
  { id: 'search-book', keys: ['Ctrl', 'F'], label: 'Search in book', scope: 'reader' },
  { id: 'read-aloud', keys: ['R'], label: 'Read aloud play / pause', scope: 'reader' },
  { id: 'font-increase', keys: ['Ctrl', '+'], label: 'Increase font size', scope: 'reader' },
  { id: 'font-decrease', keys: ['Ctrl', '−'], label: 'Decrease font size', scope: 'reader' },
]

export function isInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  return !!target.closest('input, textarea, select, [contenteditable="true"]')
}

export interface HotkeysHandlers {
  onSearch?: () => void
  onImport?: () => void
  onSettings?: () => void
  onNavigate?: (path: string) => void
  onHelp?: () => void
  onEscape?: () => void
}

export class HotkeysController {
  private gPending = false
  private gTimer: number | null = null

  private getHandlers: () => HotkeysHandlers

  constructor(getHandlers: () => HotkeysHandlers) {
    this.getHandlers = getHandlers
  }

  handleKeyDown = (e: KeyboardEvent) => {
    const handlers = this.getHandlers()
    const isInput = isInputTarget(e.target)

    // Escape always handles closing topmost layer even if in an input
    if (e.key === 'Escape') {
      if (handlers.onEscape) {
        handlers.onEscape()
        e.preventDefault()
      }
      return
    }

    // All other hotkeys are suppressed when typing in form inputs/textareas
    if (isInput) return

    const isCtrlOrCmd = e.ctrlKey || e.metaKey

    // Ctrl+K or /: Focus search
    if ((isCtrlOrCmd && e.key.toLowerCase() === 'k') || (!isCtrlOrCmd && !e.shiftKey && e.key === '/')) {
      e.preventDefault()
      handlers.onSearch?.()
      return
    }

    // Ctrl+O: Add books
    if (isCtrlOrCmd && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      handlers.onImport?.()
      return
    }

    // Ctrl+,: Settings
    if (isCtrlOrCmd && e.key === ',') {
      e.preventDefault()
      handlers.onSettings?.()
      return
    }

    // ?: Keyboard shortcuts help
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault()
      handlers.onHelp?.()
      return
    }

    // Two-key G then H/L/N/S navigation sequence
    if (!isCtrlOrCmd && !e.altKey) {
      if (this.gPending) {
        this.clearGSequence()
        const key = e.key.toLowerCase()
        if (key === 'h') {
          e.preventDefault()
          handlers.onNavigate?.('/')
          return
        }
        if (key === 'l') {
          e.preventDefault()
          handlers.onNavigate?.('/library')
          return
        }
        if (key === 'n') {
          e.preventDefault()
          handlers.onNavigate?.('/notebook')
          return
        }
        if (key === 's') {
          e.preventDefault()
          handlers.onNavigate?.('/store')
          return
        }
      } else if (e.key.toLowerCase() === 'g') {
        this.gPending = true
        if (typeof window !== 'undefined') {
          if (this.gTimer) window.clearTimeout(this.gTimer)
          this.gTimer = window.setTimeout(() => {
            this.gPending = false
          }, 1000)
        }
        return
      }
    }
  }

  clearGSequence() {
    this.gPending = false
    if (this.gTimer && typeof window !== 'undefined') {
      window.clearTimeout(this.gTimer)
      this.gTimer = null
    }
  }
}

export function useGlobalHotkeys(handlers: HotkeysHandlers) {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const controller = new HotkeysController(() => handlersRef.current)
    const onKey = (e: KeyboardEvent) => controller.handleKeyDown(e)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      controller.clearGSequence()
    }
  }, [])
}
