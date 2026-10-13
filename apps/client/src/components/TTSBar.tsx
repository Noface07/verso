import { Pause, Play, SkipBack, SkipForward, X, Volume2 } from 'lucide-react';
import { baseLang } from '../lib/lookup';
import type { TTSState } from '../lib/tts';
import type { TtsVoice } from '../lib/ttsEngine';
import { IconButton } from '../design/components/IconButton';

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

export function TTSBar({
  state,
  rate,
  voiceURI,
  voices,
  lang,
  onPlayPause,
  onPrev,
  onNext,
  onStop,
  onRate,
  onVoice,
  sleepTimer,
  onSleepTimer,
}: {
  state: TTSState;
  rate: number;
  voiceURI: string;
  voices: (SpeechSynthesisVoice | TtsVoice)[];
  lang: string;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStop: () => void;
  onRate: (r: number) => void;
  onVoice: (uri: string) => void;
  sleepTimer?: number;
  onSleepTimer?: (mins: number) => void;
}) {
  const base = baseLang(lang);
  const matches = (v: SpeechSynthesisVoice | TtsVoice) => v.lang.toLowerCase().startsWith(base);
  const sorted = [...voices].sort(
    (a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name),
  );

  return (
    <div
      role="toolbar"
      aria-label="Read aloud controls"
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-2 rounded-[var(--r-pill)] bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] backdrop-blur-[var(--blur)] select-none animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
    >
      <div className="flex items-center gap-1.5 text-[var(--accent)] pl-1 pr-2 border-r border-[var(--stroke)]">
        <Volume2 className="w-4 h-4 animate-pulse" />
        <span className="text-xs font-semibold uppercase tracking-wider hidden sm:inline">TTS</span>
      </div>

      <IconButton
        label="Previous paragraph"
        icon={<SkipBack className="w-4 h-4" />}
        size="sm"
        onClick={onPrev}
      />

      <button
        type="button"
        aria-label={state === 'playing' ? 'Pause read aloud' : 'Play read aloud'}
        onClick={onPlayPause}
        className="w-8 h-8 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-xs cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {state === 'playing' ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      <IconButton
        label="Next paragraph"
        icon={<SkipForward className="w-4 h-4" />}
        size="sm"
        onClick={onNext}
      />

      <div className="h-4 w-[1px] bg-[var(--stroke)] mx-1" />

      {/* Speed Rate Select */}
      <select
        value={rate}
        onChange={(e) => onRate(Number(e.target.value))}
        aria-label="Reading Speed"
        className="h-7 px-2 text-xs font-medium rounded-[var(--r-sm)] bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none cursor-pointer hover:bg-[var(--layer-3)]"
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>

      {/* Voice Select */}
      <select
        value={voiceURI}
        onChange={(e) => onVoice(e.target.value)}
        aria-label="Speech Voice"
        className="h-7 px-2 text-xs font-medium rounded-[var(--r-sm)] bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none cursor-pointer max-w-[130px] sm:max-w-[180px] truncate hover:bg-[var(--layer-3)]"
      >
        <option value="">Default voice</option>
        {sorted.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>

      {/* Sleep Timer Select */}
      {onSleepTimer && (
        <select
          value={sleepTimer ?? 0}
          onChange={(e) => onSleepTimer(Number(e.target.value))}
          aria-label="Sleep timer"
          className="h-7 px-2 text-xs font-medium rounded-[var(--r-sm)] bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none cursor-pointer hover:bg-[var(--layer-3)]"
        >
          <option value={0}>Timer off</option>
          <option value={15}>15 min sleep</option>
          <option value={30}>30 min sleep</option>
          <option value={60}>60 min sleep</option>
          <option value={-1}>End of chapter</option>
        </select>
      )}

      <div className="h-4 w-[1px] bg-[var(--stroke)] mx-1" />

      <IconButton
        label="Stop read aloud"
        icon={<X className="w-4 h-4" />}
        size="sm"
        variant="subtle"
        onClick={onStop}
      />
    </div>
  );
}