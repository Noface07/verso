/**
 * Tauri desktop integration helpers.
 * Gracefully degrades when running in browser / web environments.
 */

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
  );
}

/**
 * Minimizes the current desktop window.
 */
export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  } catch (err) {
    console.warn('Failed to minimize window:', err);
  }
}

/**
 * Toggles maximize / restore on the current desktop window.
 */
export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  } catch (err) {
    console.warn('Failed to toggle maximize window:', err);
  }
}

/**
 * Checks if the window is currently maximized.
 */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return await getCurrentWindow().isMaximized();
  } catch {
    return false;
  }
}

/**
 * Closes the current desktop application window.
 */
/**
 * Calls `cb` whenever the window is resized (maximise/restore/snap included).
 * Event-driven replacement for polling `isMaximized()`. Returns an unsubscribe.
 */
export async function onWindowResized(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return await getCurrentWindow().onResized(cb);
  } catch (err) {
    console.error('Failed to listen for window resize:', err);
    return () => {};
  }
}

export async function closeWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch (err) {
    console.warn('Failed to close window:', err);
  }
}

/**
 * Toggles fullscreen on the desktop window.
 */
export async function toggleTauriFullscreen(): Promise<void> {
  if (!isTauri()) {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
    return;
  }
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const isFs = await win.isFullscreen();
    await win.setFullscreen(!isFs);
  } catch (err) {
    console.warn('Failed to toggle Tauri fullscreen:', err);
  }
}

/**
 * Listens for file-open events emitted when a file is opened via Windows Explorer
 * or dropped onto the application executable.
 */
export async function listenFileOpen(
  callback: (filePath: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<string>('folio://file-open', (event) => {
      if (event.payload) callback(event.payload);
    });
    return unlisten;
  } catch (err) {
    console.warn('Failed to register file-open listener:', err);
    return () => {};
  }
}

/**
 * Listens for deep-link protocol events (folio://).
 */
export async function listenDeepLink(
  callback: (url: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    const unlisten = await onOpenUrl((urls) => {
      for (const url of urls) {
        callback(url);
      }
    });
    return unlisten;
  } catch (err) {
    console.warn('Deep-link plugin not available:', err);
    return () => {};
  }
}

/**
 * Opens an external URL in the default desktop system browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // Fall through to window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
