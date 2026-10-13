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

/** Running on an Android device (the Tauri mobile build or a mobile browser). */
export function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * Opens an external page (e.g. an official publisher's chapter) inside Folio: in a
 * separate app window on desktop, falling back to the system browser elsewhere.
 * The window loads remote content only; it gets no access to Folio's APIs because
 * capabilities are granted to the "main" window alone.
 */
export async function openInAppWindow(url: string, title = 'Folio'): Promise<void> {
  if (isTauri() && !isAndroidDevice()) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = new WebviewWindow(`external-${Date.now()}`, {
        url,
        title,
        width: 1100,
        height: 900,
        center: true,
        focus: true,
      });
      await new Promise<void>((resolve, reject) => {
        void win.once('tauri://created', () => resolve());
        void win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
      });
      return;
    } catch (err) {
      console.warn('In-app window failed, using the browser instead:', err);
    }
  }
  await openExternalUrl(url);
}

/**
 * Asks for confirmation and waits for the answer. In Tauri, window.confirm does
 * not block (it returns before the user answers), so actions ran immediately and
 * the dialog appeared afterwards. Uses the native dialog there instead.
 */
export async function confirmAction(message: string, title = 'Folio'): Promise<boolean> {
  if (isTauri()) {
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return await ask(message, { title, kind: 'warning' });
    } catch {
      // Fall through to the browser dialog.
    }
  }
  return window.confirm(message);
}

