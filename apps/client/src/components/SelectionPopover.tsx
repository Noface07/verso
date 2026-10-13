import {
  BookA, Bookmark, Copy, Globe, Highlighter, Languages, Search,
  StickyNote, Strikethrough, Trash2, Underline, Volume2, Waves,
} from 'lucide-react'
import type { HighlightStyle } from '../db'
import { HIGHLIGHT_COLORS } from '../lib/readerSettings'
import { LookupCard, type LookupTab } from './LookupCard'

export interface MenuAnchor { x: number; top: number; bottom: number }

const STYLES: { id: HighlightStyle; label: string; icon: typeof Highlighter }[] = [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikethrough', label: 'Strikethrough', icon: Strikethrough },
  { id: 'squiggly', label: 'Squiggly underline', icon: Waves },
]

export function SelectionPopover(props: {
  anchor: MenuAnchor
  text: string
  color: string
  style: HighlightStyle
  existing: boolean
  hasNote: boolean
  lookup: LookupTab | null
  lang: string
  translateTo: string
  onLookup: (tab: LookupTab | null) => void
  onTranslateTo: (lang: string) => void
  onSpeakText: (text: string) => void
  onColor: (color: string) => void
  onStyle: (style: HighlightStyle) => void
  onNote: () => void
  onBookmark: () => void
  onReadAloud: () => void
  onSearch: () => void
  onCopy: () => void
  onDelete?: () => void
}) {
  const { anchor, lookup } = props
  const width = Math.min(410, window.innerWidth - 16)
  const left = Math.min(Math.max(anchor.x - width / 2, 8), window.innerWidth - width - 8)
  const needed = lookup ? 420 : 130
  const above = anchor.top > needed + 56
  const pos = above ? { bottom: window.innerHeight - anchor.top + 10 } : { top: anchor.bottom + 10 }

  const card = lookup && (
    <LookupCard
      key={props.text}
      text={props.text}
      tab={lookup}
      onTab={props.onLookup}
      lang={props.lang}
      translateTo={props.translateTo}
      onTranslateTo={props.onTranslateTo}
      onSpeak={props.onSpeakText}
      onClose={() => props.onLookup(null)}
    />
  )

  const toggle = (t: LookupTab) => props.onLookup(lookup === t ? null : t)

  return (
    <div className={`popover ${above ? 'above' : 'below'}`} style={{ left, width, ...pos }}>
      {above && card}
      <div className="pop-toolbar">
        <div className="pop-row">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.id}
              className={`swatch ${props.existing && props.color === c.id ? 'active' : ''}`}
              style={{ background: c.hex }}
              title={c.label}
              aria-label={`${c.label} highlight`}
              onClick={() => props.onColor(c.id)}
            />
          ))}
          <span className="sep" />
          {STYLES.map((s) => (
            <button
              key={s.id}
              className={`icon-btn sm ${props.style === s.id ? 'active' : ''}`}
              title={s.label}
              aria-label={s.label}
              onClick={() => props.onStyle(s.id)}
            >
              <s.icon size={16} />
            </button>
          ))}
        </div>
        <div className="pop-row tools">
          <button className={`pop-btn ${props.hasNote ? 'active' : ''}`} title={props.hasNote ? 'Edit note' : 'Add note'} onClick={props.onNote}><StickyNote size={17} /></button>
          <button className="pop-btn" title="Bookmark here" onClick={props.onBookmark}><Bookmark size={17} /></button>
          <button className={`pop-btn ${lookup === 'define' ? 'active' : ''}`} title="Dictionary" onClick={() => toggle('define')}><BookA size={17} /></button>
          <button className={`pop-btn ${lookup === 'translate' ? 'active' : ''}`} title="Translate" onClick={() => toggle('translate')}><Languages size={17} /></button>
          <button className={`pop-btn ${lookup === 'wiki' ? 'active' : ''}`} title="Wikipedia" onClick={() => toggle('wiki')}><Globe size={17} /></button>
          <button className="pop-btn" title="Read aloud from here" onClick={props.onReadAloud}><Volume2 size={17} /></button>
          <button className="pop-btn" title="Search in book" onClick={props.onSearch}><Search size={17} /></button>
          <button className="pop-btn" title="Copy" onClick={props.onCopy}><Copy size={17} /></button>
          {props.onDelete && <button className="pop-btn danger" title="Delete highlight" onClick={props.onDelete}><Trash2 size={17} /></button>}
        </div>
      </div>
      {!above && card}
    </div>
  )
}