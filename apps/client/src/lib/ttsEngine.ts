import { isTauri } from './tauri';

export interface TtsVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
}

export interface TtsSpeakOptions {
  rate?: number;
  pitch?: number;
  voiceURI?: string;
  lang?: string;
  onRangeStart?: (charIndex: number, charLength: number) => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

export interface TtsEngine {
  isSupported(): boolean;
  speak(text: string, utteranceId: string, options?: TtsSpeakOptions): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getVoices(): Promise<TtsVoice[]>;
  setMetadata?(title: string, chapter: string): Promise<void>;
}

/**
 * Web Speech API implementation for modern browsers and WebView fallback.
 */
export class WebSpeechEngine implements TtsEngine {
  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  async speak(text: string, _utteranceId: string, options?: TtsSpeakOptions): Promise<void> {
    if (!this.isSupported()) {
      options?.onError?.(new Error('SpeechSynthesis not supported'));
      return;
    }

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);

    if (options?.rate) u.rate = options.rate;
    if (options?.pitch) u.pitch = options.pitch;

    if (options?.voiceURI) {
      const matched = window.speechSynthesis.getVoices().find((v) => v.voiceURI === options.voiceURI);
      if (matched) u.voice = matched;
    }
    if (options?.lang && !u.voice) {
      u.lang = options.lang;
    }

    u.onboundary = (e) => {
      // charIndex from SpeechSynthesisEvent
      const idx = e.charIndex ?? 0;
      const len = e.charLength ?? 0;
      options?.onRangeStart?.(idx, len);
    };

    u.onend = () => {
      options?.onDone?.();
    };

    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      options?.onError?.(e);
    };

    window.speechSynthesis.speak(u);
  }

  async stop(): Promise<void> {
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  async pause(): Promise<void> {
    if (this.isSupported()) {
      window.speechSynthesis.pause();
    }
  }

  async resume(): Promise<void> {
    if (this.isSupported()) {
      window.speechSynthesis.resume();
    }
  }

  async getVoices(): Promise<TtsVoice[]> {
    if (!this.isSupported()) return [];
    return window.speechSynthesis.getVoices().map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      default: v.default,
    }));
  }
}

/**
 * Native Android TTS engine integrating with Kotlin TextToSpeech & Foreground Media Service.
 */
export class NativeAndroidTtsEngine implements TtsEngine {
  private activeUtteranceId: string | null = null;
  private currentOptions: TtsSpeakOptions | null = null;
  private unlistenRange: (() => void) | null = null;
  private unlistenDone: (() => void) | null = null;

  isSupported(): boolean {
    // True if in Tauri environment
    return isTauri();
  }

  private async setupListeners() {
    if (this.unlistenRange && this.unlistenDone) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const unRange = await listen<{ utteranceId: string; start: number; end: number }>(
        'folio://tts-range-start',
        (event) => {
          if (event.payload && event.payload.utteranceId === this.activeUtteranceId) {
            const start = event.payload.start;
            const len = Math.max(0, event.payload.end - start);
            this.currentOptions?.onRangeStart?.(start, len);
          }
        },
      );
      const unDone = await listen<{ utteranceId: string }>('folio://tts-done', (event) => {
        if (event.payload && event.payload.utteranceId === this.activeUtteranceId) {
          this.activeUtteranceId = null;
          this.currentOptions?.onDone?.();
        }
      });
      this.unlistenRange = unRange;
      this.unlistenDone = unDone;
    } catch {
      // Ignored outside Tauri
    }
  }

  async speak(text: string, utteranceId: string, options?: TtsSpeakOptions): Promise<void> {
    this.activeUtteranceId = utteranceId;
    this.currentOptions = options ?? null;
    await this.setupListeners();

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:folio_tts|speak', {
        text,
        utteranceId,
        rate: options?.rate ?? 1.0,
        pitch: options?.pitch ?? 1.0,
        voice: options?.voiceURI,
      });
    } catch (err) {
      console.warn('Native Android TTS invocation failed, falling back to WebSpeech:', err);
      const fallback = new WebSpeechEngine();
      return fallback.speak(text, utteranceId, options);
    }
  }

  async stop(): Promise<void> {
    this.activeUtteranceId = null;
    this.currentOptions = null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:folio_tts|stop');
    } catch {
      window.speechSynthesis?.cancel();
    }
  }

  async pause(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:folio_tts|pause');
    } catch {
      window.speechSynthesis?.pause();
    }
  }

  async resume(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:folio_tts|resume');
    } catch {
      window.speechSynthesis?.resume();
    }
  }

  async getVoices(): Promise<TtsVoice[]> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ voices: { name: string; locale: string }[] }>('plugin:folio_tts|listVoices');
      if (res?.voices && Array.isArray(res.voices)) {
        return res.voices.map((v) => ({
          voiceURI: v.name,
          name: v.name,
          lang: v.locale,
        }));
      }
    } catch {
      // Fall back to web voices
    }
    const fallback = new WebSpeechEngine();
    return fallback.getVoices();
  }

  async setMetadata(title: string, chapter: string): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:folio_tts|setMetadata', { title, chapter });
    } catch {
      // No-op
    }
  }
}

let activeEngine: TtsEngine | null = null;

export function getTtsEngine(): TtsEngine {
  if (!activeEngine) {
    if (isTauri()) {
      activeEngine = new NativeAndroidTtsEngine();
    } else {
      activeEngine = new WebSpeechEngine();
    }
  }
  return activeEngine;
}
