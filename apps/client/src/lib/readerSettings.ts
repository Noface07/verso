import { useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, dirty, type HighlightStyle } from '../db'
import type { FoliateView } from './foliate'

export type ThemeId = 'auto' | 'light' | 'sepia' | 'green' | 'dusk' | 'dark' | 'black' | 'custom'
export type PageAnimation = 'none' | 'slide' | 'fade'

export interface CustomTheme {
  name: string
  bg: string
  fg: string
  link: string
  dark: boolean
  highlightOpacity?: number
}

export const THEMES: Record<Exclude<ThemeId, 'custom' | 'auto'>, { name: string; bg: string; fg: string; link: string; dark: boolean }> = {
  light: { name: 'Paper', bg: '#fbfbf8', fg: '#1f1f1f', link: '#2563eb', dark: false },
  sepia: { name: 'Sepia', bg: '#f4ecd8', fg: '#5b4636', link: '#8b5a2b', dark: false },
  green: { name: 'Sage', bg: '#dfeedd', fg: '#22331f', link: '#2f6b3a', dark: false },
  dusk: { name: 'Dusk', bg: '#2b2a33', fg: '#d8d4cf', link: '#9ab8ff', dark: true },
  dark: { name: 'Night', bg: '#1c1c1e', fg: '#d6d6d6', link: '#8ab4f8', dark: true },
  black: { name: 'OLED', bg: '#000000', fg: '#b8b8b8', link: '#8ab4f8', dark: true },
}

export const BUNDLED_FONTS: { id: string; label: string; css: string }[] = [
  { id: 'book', label: 'Book default', css: '' },
  { id: 'literata', label: 'Literata', css: '"Literata", Georgia, serif' },
  { id: 'source-serif', label: 'Source Serif 4', css: '"Source Serif 4", Georgia, serif' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', css: '"Atkinson Hyperlegible", sans-serif' },
  { id: 'inter', label: 'Inter', css: '"Inter Variable", "Inter", system-ui, sans-serif' },
  { id: 'serif', label: 'Classic serif', css: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif' },
  { id: 'literary', label: 'Literary', css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  { id: 'mono', label: 'Monospace', css: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace' },
]

export const FONTS = BUNDLED_FONTS

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
  customTheme?: CustomTheme
  matchAppTheme: boolean
  nightLight: number // 0 to 40%
  dimOverlay: number // 0 to 60%
  font: string
  fontSize: number
  lineHeight: number
  paragraphSpacing: number // 0 to 24px
  firstLineIndent: number // 0 to 32px
  wordSpacing: number // -2 to 8px
  letterSpacing: number // -1 to 4px
  boldText: boolean
  overridePublisher: boolean
  pageAnimation: PageAnimation
  autoPaging: boolean
  autoPagingInterval: number // seconds per page
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
  ttsSleepTimer: number // minutes, 0 = off
  ttsVoiceMap: Record<string, string> // lang -> voice URI
  translateTo: string
  autoDefine: boolean
  wheelPaging: boolean
  wheelInvert: boolean
  tapZones: 'split' | 'allNext'
  volumeKeysTurn?: boolean
  haptics?: boolean
  keepScreenOn?: boolean
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  // Follows the app: a dark app opens books on a true-black (OLED) page.
  theme: 'auto',
  customTheme: {
    name: 'Custom',
    bg: '#fbfbf8',
    fg: '#1f1f1f',
    link: '#2563eb',
    dark: false,
    highlightOpacity: 0.35,
  },
  matchAppTheme: false,
  nightLight: 0,
  dimOverlay: 0,
  font: 'book',
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 0,
  firstLineIndent: 0,
  wordSpacing: 0,
  letterSpacing: 0,
  boldText: false,
  overridePublisher: true,
  pageAnimation: 'slide',
  autoPaging: false,
  autoPagingInterval: 15,
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
  ttsSleepTimer: 0,
  ttsVoiceMap: {},
  translateTo: 'hi',
  autoDefine: true,
  wheelPaging: true,
  wheelInvert: false,
  tapZones: 'split',
  volumeKeysTurn: false,
  haptics: true,
  keepScreenOn: true,
}

/** The app's current light/dark mode (set on <html> by the ThemeProvider). */
const appIsDark = () =>
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light'

export function getEffectiveTheme(s: ReaderSettings): { name: string; bg: string; fg: string; link: string; dark: boolean } {
  if (s.theme === 'custom' && s.customTheme) {
    return s.customTheme
  }
  if (s.theme === 'auto') return appIsDark() ? THEMES.black : THEMES.light
  return THEMES[s.theme as keyof typeof THEMES] ?? THEMES.light
}

export function bookCSS(s: ReaderSettings, extraFontFaceCSS: string = ''): string {
  const t = getEffectiveTheme(s)
  const bundled = BUNDLED_FONTS.find((f) => f.id === s.font)?.css
  const font = bundled || (s.font !== 'book' ? `"${s.font}", sans-serif` : '')
  const hyph = s.hyphenate ? 'auto' : 'manual'

  return `
@namespace epub "http://www.idpf.org/2007/ops";
${extraFontFaceCSS}
html { color-scheme: ${t.dark ? 'dark' : 'light'}; font-size: ${s.fontSize}px !important; }
html, body { background: transparent !important; color: ${t.fg} !important; }
${s.overridePublisher ? 'body *:not(a) { color: inherit !important; }' : ''}
${t.dark ? 'body * { background-color: transparent !important; }' : ''}
a:any-link, a:any-link * { color: ${t.link} !important; }
${font ? `body, body *:not(code):not(pre):not(kbd) { font-family: ${font} !important; }` : ''}
p, li, blockquote, dd, dt, div {
  line-height: ${s.lineHeight} !important;
  ${s.wordSpacing !== 0 ? `word-spacing: ${s.wordSpacing}px !important;` : ''}
  ${s.letterSpacing !== 0 ? `letter-spacing: ${s.letterSpacing}px !important;` : ''}
}
${s.paragraphSpacing > 0 ? `p { margin-bottom: ${s.paragraphSpacing}px !important; margin-top: 0 !important; }` : ''}
${s.firstLineIndent > 0 ? `p { text-indent: ${s.firstLineIndent}px !important; }` : ''}
${s.boldText ? 'body, p, li, blockquote, dd, dt, div, span { font-weight: 600 !important; }' : ''}
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

export function applyLayout(renderer: FoliateView['renderer'], s: ReaderSettings, extraFontFaceCSS: string = '') {
  if (!renderer) return
  renderer.setAttribute('flow', s.flow)
  renderer.setAttribute('gap', `${s.gap}%`)
  renderer.setAttribute('margin', '20px')
  renderer.setAttribute('max-inline-size', `${s.maxWidth}px`)
  renderer.setAttribute('max-column-count', String(s.columns))
  if (s.animated || s.pageAnimation !== 'none') renderer.setAttribute('animated', '')
  else renderer.removeAttribute('animated')
  renderer.setStyles?.(bookCSS(s, extraFontFaceCSS))
}

export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const row = useLiveQuery(() => db.settings.get('reader'), [])
  const settings = useMemo(() => {
    const stored = (row?.data ?? {}) as Partial<ReaderSettings> & { themeV?: number }
    const merged = { ...DEFAULT_SETTINGS, ...stored }
    // Before 'auto' existed, saving any setting also persisted the then-default
    // 'light' theme, so a stored 'light' from that era wasn't a real choice.
    if (!stored.themeV && stored.theme === 'light') merged.theme = 'auto'
    return merged
  }, [row])
  const update = useCallback((patch: Partial<ReaderSettings>) => {
    void db.transaction('rw', db.settings, async () => {
      const cur = await db.settings.get('reader')
      await db.settings.put({
        id: 'reader',
        // themeV marks settings written after 'auto' was introduced (see above).
        data: { ...DEFAULT_SETTINGS, ...(cur?.data ?? {}), ...patch, themeV: 2 },
        deleted_at: null,
        ...dirty(),
      })
    })
  }, [])
  return [settings, update]
}