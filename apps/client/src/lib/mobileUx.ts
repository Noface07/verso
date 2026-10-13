import { useEffect, useRef } from 'react';
import { isTauri } from './tauri';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

let wakeLockSentinel: WakeLockSentinelLike | null = null;

interface NavigatorWithWakeLock {
  wakeLock?: {
    request(type: string): Promise<WakeLockSentinelLike>;
  };
}

/**
 * Keeps the screen awake during reading.
 * Uses the Web Screen Wake Lock API or native Android window flag via Tauri.
 */
export async function setKeepScreenOn(enabled: boolean): Promise<void> {
  if (enabled) {
    try {
      const nav = navigator as unknown as NavigatorWithWakeLock;
      if (nav.wakeLock?.request) {
        wakeLockSentinel = await nav.wakeLock.request('screen');
      }
    } catch {
      // Wake lock request failed or permissions denied
    }

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('plugin:folio_tts|setKeepScreenOn', { enabled: true });
      } catch {
        // Ignored
      }
    }
  } else {
    try {
      if (wakeLockSentinel) {
        await wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
    } catch {
      // Ignored
    }

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('plugin:folio_tts|setKeepScreenOn', { enabled: false });
      } catch {
        // Ignored
      }
    }
  }
}

/**
 * Triggers subtle haptic feedback on page turn or interaction.
 */
export function triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
    try {
      const ms = type === 'heavy' ? 40 : type === 'medium' ? 25 : 12;
      navigator.vibrate(ms);
    } catch {
      // Vibration not permitted or supported
    }
  }
}

/**
 * React hook to listen for hardware volume keys to turn pages in the reader (P11.5).
 */
export function useVolumeKeys(
  onNext: () => void,
  onPrev: () => void,
  enabled: boolean,
): void {
  const nextRef = useRef(onNext);
  const prevRef = useRef(onPrev);
  nextRef.current = onNext;
  prevRef.current = onPrev;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Android WebView sends VolumeUp (keyCode 24) and VolumeDown (keyCode 25)
      // or key "VolumeUp" / "VolumeDown" / "AudioVolumeUp" / "AudioVolumeDown"
      const keyCode = 'keyCode' in e ? (e as { keyCode: number }).keyCode : undefined;
      if (e.key === 'VolumeUp' || e.code === 'AudioVolumeUp' || keyCode === 24) {
        e.preventDefault();
        e.stopPropagation();
        prevRef.current();
      } else if (e.key === 'VolumeDown' || e.code === 'AudioVolumeDown' || keyCode === 25) {
        e.preventDefault();
        e.stopPropagation();
        nextRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [enabled]);
}

export interface PullToRefreshState {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
}
