import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { baseLang } from '../lib/lookup'
import type { TTSState } from '../lib/tts'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]

export function TTSBar({ state, rate, voiceURI, voices, lang, onPlayPause, onPrev, onNext, onStop, onRate, onVoice }: {
  state: TTSState
  rate: number
  voiceURI: string
  voices: SpeechSynthesisVoice[]
  lang: string
  onPlayPause: () => void
  onPrev: () => void
  onNext: () => void
  onStop: () => void
  onRate: (r: number) => void
  onVoice: (uri: string) => void
}) {
  const base = baseLang(lang)
  const matches = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith(base)
  const sorted = [...voices].sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.name.localeCompare(b.name))

  return (
    <div className="tts-bar" role="toolbar" aria-label="Read aloud controls">
      <button className="icon-btn" title="Previous paragraph" onClick={onPrev}><SkipBack size={18} /></button>
      <button className="tts-play" title={state === 'playing' ? 'Pause' : 'Play'} onClick={onPlayPause}>
        {state === 'playing' ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button className="icon-btn" title="Next paragraph" onClick={onNext}><SkipForward size={18} /></button>
      <span className="sep" />
      <select className="field sm" value={rate} onChange={(e) => onRate(Number(e.target.value))} aria-label="Speed">
        {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
      <select className="field sm voice" value={voiceURI} onChange={(e) => onVoice(e.target.value)} aria-label="Voice">
        <option value="">Default voice</option>
        {sorted.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
      </select>
      <button className="icon-btn" title="Stop" onClick={onStop}><X size={18} /></button>
    </div>
  )
}