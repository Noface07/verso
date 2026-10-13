import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebSpeechEngine,
  NativeAndroidTtsEngine,
  getTtsEngine,
} from '../src/lib/ttsEngine';
import {
  registerBackHandler,
  handleBackPress,
  clearBackHandlers,
  getBackHandlerCount,
  initAndroidBackHandler,
} from '../src/lib/backStack';
import {
  triggerHaptic,
  setKeepScreenOn,
} from '../src/lib/mobileUx';
import { initAndroidIntegration } from '../src/lib/androidIntegration';

describe('Phase 11: Tauri Android & Mobile UX', () => {
  beforeEach(() => {
    clearBackHandlers();
  });

  afterEach(() => {
    clearBackHandlers();
    vi.restoreAllMocks();
  });

  describe('P11.2: Native & Web TTS Engine Abstraction', () => {
    it('getTtsEngine returns a valid TtsEngine singleton', () => {
      const engine = getTtsEngine();
      expect(engine).toBeDefined();
      expect(typeof engine.speak).toBe('function');
      expect(typeof engine.stop).toBe('function');
      expect(typeof engine.pause).toBe('function');
      expect(typeof engine.resume).toBe('function');
      expect(typeof engine.getVoices).toBe('function');
    });

    it('WebSpeechEngine gracefully handles lack of SpeechSynthesis in headless environment', async () => {
      const engine = new WebSpeechEngine();
      // In node/happy-dom without speechSynthesis
      expect(typeof engine.isSupported()).toBe('boolean');

      const onEndSpy = vi.fn();
      const onErrorSpy = vi.fn();

      await engine.speak('Hello world', 'test-utt-1', {
        onDone: onEndSpy,
        onError: onErrorSpy,
      });

      await engine.stop();
      await engine.pause();
      await engine.resume();
      const voices = await engine.getVoices();
      expect(Array.isArray(voices)).toBe(true);
    });

    it('NativeAndroidTtsEngine handles stop, pause, resume, and voice list fallbacks', async () => {
      const engine = new NativeAndroidTtsEngine();
      expect(typeof engine.isSupported()).toBe('boolean');

      await expect(engine.stop()).resolves.toBeUndefined();
      await expect(engine.pause()).resolves.toBeUndefined();
      await expect(engine.resume()).resolves.toBeUndefined();

      const voices = await engine.getVoices();
      expect(Array.isArray(voices)).toBe(true);
    });
  });

  describe('P11.1 & P11.3: Back Button Layer Hierarchy Stack', () => {
    it('executes handlers in descending priority order and respects consumption', () => {
      const calls: string[] = [];

      // Register modal handler with low priority
      const unregisterModal = registerBackHandler(() => {
        calls.push('modal');
        return true;
      }, 20);

      // Register popover handler with high priority
      const unregisterPopover = registerBackHandler(() => {
        calls.push('popover');
        return true;
      }, 80);

      // Register image viewer with medium priority
      const unregisterImageViewer = registerBackHandler(() => {
        calls.push('imageViewer');
        return true;
      }, 50);

      expect(getBackHandlerCount()).toBe(3);

      // First back press should hit Popover (highest priority: 80)
      const handled1 = handleBackPress();
      expect(handled1).toBe(true);
      expect(calls).toEqual(['popover']);

      // Unregister popover as it closed
      unregisterPopover();
      expect(getBackHandlerCount()).toBe(2);

      // Second back press should hit ImageViewer (priority: 50)
      const handled2 = handleBackPress();
      expect(handled2).toBe(true);
      expect(calls).toEqual(['popover', 'imageViewer']);

      unregisterImageViewer();

      // Third back press should hit Modal (priority: 20)
      const handled3 = handleBackPress();
      expect(handled3).toBe(true);
      expect(calls).toEqual(['popover', 'imageViewer', 'modal']);

      unregisterModal();
      expect(getBackHandlerCount()).toBe(0);

      // Fourth back press with empty stack returns false
      const handled4 = handleBackPress();
      expect(handled4).toBe(false);
    });

    it('cascades to next handler if a handler returns false', () => {
      const calls: string[] = [];

      registerBackHandler(() => {
        calls.push('skipped-high');
        return false; // did not consume
      }, 100);

      registerBackHandler(() => {
        calls.push('consumed-low');
        return true; // consumed
      }, 10);

      const handled = handleBackPress();
      expect(handled).toBe(true);
      expect(calls).toEqual(['skipped-high', 'consumed-low']);
    });

    it('initAndroidBackHandler wires up escape key listener and returns cleanup', () => {
      const fallbackSpy = vi.fn();
      const cleanup = initAndroidBackHandler(fallbackSpy);

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      window.dispatchEvent(escapeEvent);

      cleanup();
    });
  });

  describe('P11.4: Mobile UX - Haptics, WakeLock, and Intent Lifecycle', () => {
    it('triggerHaptic invokes navigator.vibrate when available', () => {
      const vibrateSpy = vi.fn();
      Object.defineProperty(navigator, 'vibrate', {
        value: vibrateSpy,
        configurable: true,
        writable: true,
      });

      triggerHaptic('light');
      expect(vibrateSpy).toHaveBeenCalledWith(12);

      triggerHaptic('medium');
      expect(vibrateSpy).toHaveBeenCalledWith(25);

      triggerHaptic('heavy');
      expect(vibrateSpy).toHaveBeenCalledWith(40);
    });

    it('setKeepScreenOn manages wake lock safely without throwing', async () => {
      await expect(setKeepScreenOn(true)).resolves.toBeUndefined();
      await expect(setKeepScreenOn(false)).resolves.toBeUndefined();
    });

    it('initAndroidIntegration returns cleanup function outside Tauri', () => {
      const navigate = vi.fn();
      const goBack = vi.fn();
      const cleanup = initAndroidIntegration(navigate, goBack);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('P11.5: Volume Keys and PullToRefresh', () => {
    it('PullToRefresh renders children properly', async () => {
      const React = await import('react');
      const { render, screen } = await import('@testing-library/react');
      const { PullToRefresh } = await import('../src/components/PullToRefresh');

      const refreshSpy = vi.fn().mockResolvedValue(undefined);
      render(
        React.createElement(
          PullToRefresh,
          { onRefresh: refreshSpy },
          React.createElement('div', { 'data-testid': 'child-content' }, 'Catalog List'),
        ),
      );

      expect(screen.getByTestId('child-content')).toHaveTextContent('Catalog List');
      expect(screen.getByTestId('pull-to-refresh-container')).toBeInTheDocument();
    });
  });
});
