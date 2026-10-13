import { useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, dirty, type HighlightStyle } from '../db'
import type { FoliateView } from './foliate'

export type ThemeId = 'light' | 'sepia' | 'green' | 'dusk' | 'dark' | 'black'

export const THEMES: Record<ThemeId, { name: string; bg: string; fg: string; link: string; dark: boolean }> = {
  light: { name: 'Paper', bg: '#fbfbf8', fg: '#1f1f1f', link: '#2563eb', dark: false },
  sepia: { name: 'Sepia', bg: '#f4ecd8', fg: '#5b4636', link: '#8b5a2b', dark: false },
  green: { name: 'Sage', bg: '#dfeedd', fg: '#22331f', link: '#2f6b3a', dark: false },
  dusk: { name: 'Dusk', bg: '#2b2a33', fg: '#d8d4cf', link: '#9ab8ff', dark: true },
  dark: { name: 'Night', bg: '#1c1c1e', fg: '#d6d6d6', link: '#8ab4f8', dark: true },
  black: { name: 'OLED', bg: '#000000', fg: '#b8b8b8', link: '#8ab4f8', dark: true },
}

export const FONTS: { id: string; label: string; css: string }[] = [
  { id: 'book', label: 'Book default', css: '' },
  { id: 'serif', label: 'Classic serif', css: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif' },
  { id: 'literary', label: 'Literary', css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  { id: 'sans', label: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'readable', label: 'Extra readable', css: 'Verdana, "Atkinson Hyperlegible", Tahoma, sans-serif' },
  { id: 'mono', label: 'Monospace', css: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
]

export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'green', label: 'Green', hex: '#4ade80' },
  { id: 'blue', label: 'Blue', hex: '#60a5fa' },
  { id: 'pink', label: 'Pink', hex: '#f472b6' },
  { id: 'purple', label: 'Purple', hex: '#a78bfa' },
  { id: 'orange', label: 'Orange', hex: '#fb923c' },
]

export const colorHex = (id: string) => HIGHLIGHT_COLORS.find((c) => c.id === id)?.hex ?? (id || '#facc15')

export interface ReaderSettings {
  theme: ThemeId
  font: string
  fontSize: number
  lineHeight: number
  gap: number
  maxWidth: number
  columns: 1 | 2
  flow: 'paginated' | 'scrolled'
  justify: boolean
  hyphenate: boolean
  animated: boolean
  lastColor: string
  lastStyle: HighlightStyle
  ttsRate: number
  ttsVoice: string
  translateTo: string
  autoDefine: boolean
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  font: 'book',
  fontSize: 18,
  lineHeight: 1.6,
  gap: 6,
  maxWidth: 720,
  columns: 2,
  flow: 'paginated',
  justify: true,
  hyphenate: true,
  animated: true,
  lastColor: 'yellow',
  lastStyle: 'highlight',
  ttsRate: 1,
  ttsVoice: '',
  translateTo: 'hi',
  autoDefine: true,
}

export function bookCSS(s: ReaderSettings): string {
  const t = THEMES[s.theme] ?? THEMES.light
  const font = FONTS.find((f) => f.id === s.font)?.css
  const hyph = s.hyphenate ? 'auto' : 'manual'
  return `
@namespace epub "http://www.idpf.org/2007/ops";
html { color-scheme: ${t.dark ? 'dark' : 'light'}; font-size: ${s.fontSize}px !important; }
html, body { background: transparent !important; color: ${t.fg} !important; }
body *:not(a) { color: inherit !important; }
${t.dark ? 'body * { background-color: transparent !important; }' : ''}
a:any-link, a:any-link * { color: ${t.link} !important; }
${font ? `body, body *:not(code):not(pre):not(kbd) { font-family: ${font} !important; }` : ''}
p, li, blockquote, dd, dt, div { line-height: ${s.lineHeight} !important; }
p, li, blockquote, dd {
  text-align: ${s.justify ? 'justify' : 'start'} !important;
  -webkit-hyphens: ${hyph}; hyphens: ${hyph};
  widows: 2; orphans: 2;
}
pre { white-space: pre-wrap !important; }
aside[epub|type~="endnote"], aside[epub|type~="footnote"],
aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
`
}

export function applyLayout(renderer: FoliateView['renderer'], s: ReaderSettings) {
  if (!renderer) return
  renderer.setAttribute('flow', s.flow)
  renderer.setAttribute('gap', `${s.gap}%`)
  renderer.setAttribute('margin', '20px')
  renderer.setAttribute('max-inline-size', `${s.maxWidth}px`)
  renderer.setAttribute('max-column-count', String(s.columns))
  if (s.animated) renderer.setAttribute('animated', '')
  else renderer.removeAttribute('animated')
  renderer.setStyles?.(bookCSS(s))
}

export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const row = useLiveQuery(() => db.settings.get('reader'), [])
  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...((row?.data ?? {}) as Partial<ReaderSettings>) }),
    [row],
  )
  const update = useCallback((patch: Partial<ReaderSettings>) => {
    void db.transaction('rw', db.settings, async () => {
      const cur = await db.settings.get('reader')
      await db.settings.put({
        id: 'reader',
        data: { ...DEFAULT_SETTINGS, ...(cur?.data ?? {}), ...patch },
        deleted_at: null,
        ...dirty(),
      })
    })
  }, [])
  return [settings, update]
}