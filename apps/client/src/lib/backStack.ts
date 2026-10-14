import { isAndroidDevice, isTauri } from './tauri';

export type BackHandler = () => boolean;

interface RegisteredHandler {
  id: string;
  handler: BackHandler;
  priority: number;
}

const backHandlers: RegisteredHandler[] = [];
let nextId = 1;

/**
 * Registers a dismiss/close handler for a UI layer (modals, sheets, popovers, image viewer).
 * Higher priority handlers are executed first when the user presses Android Back.
 * Handlers return `true` if they consumed the back action, `false` otherwise.
 */
export function registerBackHandler(
  handler: BackHandler,
  priority = 10,
): () => void {
  const id = `back-h-${nextId++}`;
  // Newest first; the sort is stable, so among equal priorities the latest wins.
  backHandlers.unshift({ id, handler, priority });
  backHandlers.sort((a, b) => b.priority - a.priority);

  return () => {
    const idx = backHandlers.findIndex((h) => h.id === id);
    if (idx !== -1) {
      backHandlers.splice(idx, 1);
    }
  };
}

/**
 * Executes the topmost back handler. Returns true if an overlay/layer was closed.
 */
export function handleBackPress(): boolean {
  for (const entry of backHandlers) {
    try {
      const consumed = entry.handler();
      if (consumed) {
        return true;
      }
    } catch (err) {
      console.warn('Error in back handler:', err);
    }
  }
  return false;
}

/**
 * Returns number of registered back handlers.
 */
export function getBackHandlerCount(): number {
  return backHandlers.length;
}

/**
 * Clears all registered back handlers (useful in tests).
 */
export function clearBackHandlers(): void {
  backHandlers.length = 0;
}

/**
 * Routes the Android back button (Tauri >= 2.9 `onBackButtonPress`) through the
 * back stack: the topmost layer closes first, otherwise `onFallbackBack` runs.
 */
export function initAndroidBackHandler(onFallbackBack?: () => void): () => void {
  let unregister: (() => void) | null = null;
  let disposed = false;

  if (isTauri() && isAndroidDevice()) {
    void (async () => {
      try {
        const { onBackButtonPress } = await import('@tauri-apps/api/app');
        const listener = await onBackButtonPress(() => {
          if (!handleBackPress()) onFallbackBack?.();
        });
        if (disposed) void listener.unregister();
        else unregister = () => void listener.unregister();
      } catch (err) {
        console.warn('Android back button handler unavailable:', err);
      }
    })();
  }

  // Also intercept Escape key on desktop/web as an accessibility convenience
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      const consumed = handleBackPress();
      if (consumed) {
        e.preventDefault();
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);

  return () => {
    disposed = true;
    unregister?.();
    window.removeEventListener('keydown', onKeyDown);
  };
}
