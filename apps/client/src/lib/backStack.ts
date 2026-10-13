import { isTauri } from './tauri';

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
  backHandlers.push({ id, handler, priority });
  // Keep sorted descending by priority
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
 * Initializes listeners for Android back button events (`folio://back-pressed`).
 */
export function initAndroidBackHandler(onFallbackBack?: () => void): () => void {
  let unlistenTauri = () => {};

  if (isTauri()) {
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlistenTauri = await listen('folio://back-pressed', () => {
          const consumed = handleBackPress();
          if (!consumed && onFallbackBack) {
            onFallbackBack();
          }
        });
      } catch (err) {
        console.warn('Failed to listen to folio://back-pressed:', err);
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
    unlistenTauri();
    window.removeEventListener('keydown', onKeyDown);
  };
}
