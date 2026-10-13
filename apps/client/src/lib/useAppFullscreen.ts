import { useSyncExternalStore } from 'react'
import { isTauri, onWindowResized, toggleTauriFullscreen } from './tauri'

// One shared fullscreen state for the title bar and both readers. In the desktop
// app the *window* must go fullscreen: the DOM Fullscreen API only fills the
// WebView, which already fills the window, so it visibly did nothing.
let fullscreen = false
let started = false
const subscribers = new Set<() => void>()

async function refresh(): Promise<void> {
  let next = typeof document !== 'undefined' && !!document.fullscreenElement
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      next = await getCurrentWindow().isFullscreen()
    } catch {
      // Keep the DOM answer.
    }
  }
  if (next !== fullscreen) {
    fullscreen = next
    subscribers.forEach((s) => s())
  }
}

function start(): void {
  if (started || typeof document === 'undefined') return
  started = true
  document.addEventListener('fullscreenchange', () => void refresh())
  void onWindowResized(() => void refresh())
  void refresh()
}

export function isAppFullscreen(): boolean {
  return fullscreen
}

export async function toggleAppFullscreen(): Promise<void> {
  await toggleTauriFullscreen()
  // The resize event usually reports the change; this covers platforms that don't.
  setTimeout(() => void refresh(), 200)
}

export async function exitAppFullscreen(): Promise<void> {
  if (fullscreen) await toggleAppFullscreen()
}

export function useAppFullscreen(): boolean {
  start()
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => fullscreen,
    () => false,
  )
}
