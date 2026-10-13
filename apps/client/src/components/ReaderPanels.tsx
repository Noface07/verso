import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Download, StickyNote, Trash2 } from 'lucide-react'
import type { Annotation } from '../db'
import { compareCFI, type FoliateView, type SearchHit, type TocItem } from '../lib/foliate'
import { FONTS, HIGHLIGHT_COLORS, THEMES, colorHex, type ReaderSettings, type ThemeId } from '../lib/readerSettings'
import { Modal } from './ui'

/* ---------- Table of contents ---------- */

export function TocPanel({ toc, current, onGo }: { toc: TocItem[]; current?: string; onGo: (href: string) => void }) {
  if (!toc.length) return <p className="muted-r">This book has no table of contents.</p>
  return <nav className="toc"><TocList items={toc} current={current} onGo={onGo} depth={0} /></nav>
}

function TocList({ items, current, onGo, depth }: {
  items: TocItem[]; current?: string; onGo: (href: string) => void; depth: number
}) {
  return (
    <ul>
      {items.map((it, i) => (
        <li key={`${it.href}-${i}`}>
          <button
            className={it.href === current ? 'active' : ''}
            style={{ paddingLeft: 10 + depth * 16 }}
            onClick={() => onGo(it.href)}
          >
            {it.label?.trim() || 'Untitled'}
          </button>
          {it.subitems?.length ? <TocList items={it.subitems} current={current} onGo={onGo} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

/* ---------- Full-text search ---------- */

export function SearchPanel({ view, initial, onGo }: { view: FoliateView; initial: string; onGo: (cfi: string) => void }) {
  const [query, setQuery] = useState(initial)
  const [groups, setGroups] = useState<{ label: string; hits: SearchHit[] }[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [searched, setSearched] = useState(false)
  const run = useRef(0)

  async function search(q: string) {
    const id = ++run.current
    view.clearSearch()
    setGroups([])
    setSearched(false)
    if (!q.trim()) { setProgress(null); return }
    setProgress(0)
    for await (const ev of view.search({ query: q.trim() })) {
      if (id !== run.current) return
      if (ev === 'done') break
      if ('progress' in ev) setProgress(ev.progress)
      else if (ev.subitems?.length) {
        const hits = ev.subitems
        setGroups((g) => [...g, { label: ev.label ?? '', hits }])
      }
    }
    if (id === run.current) { setProgress(null); setSearched(true) }
  }

  useEffect(() => {
    if (initial) void search(initial)
    return () => { run.current++; view.clearSearch() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = groups.reduce((n, g) => n + g.hits.length, 0)

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); void search(query) }}>
        <input className="field" autoFocus placeholder="Search in this book…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>
      {progress !== null && <div className="rbar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      {searched && <p className="muted-r small">{total ? `${total} result${total === 1 ? '' : 's'}` : 'No results'}</p>}
      {groups.map((g, i) => (
        <div key={i}>
          {g.label && <div className="group-label">{g.label}</div>}
          {g.hits.map((h) => (
            <button key={h.cfi} className="result" onClick={() => onGo(h.cfi)}>
              …{h.excerpt.pre}<mark>{h.excerpt.match}</mark>{h.excerpt.post}…
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

/* ---------- Highlights, notes, bookmarks ---------- */

type Tab = 'all' | 'highlight' | 'note' | 'bookmark'
const TAB_LABEL: Record<Tab, string> = { all: 'All', highlight: 'Highlights', note: 'Notes', bookmark: 'Bookmarks' }

function exportMarkdown(title: string, author: string, list: Annotation[]) {
  const lines = [`# ${title}`, `*${author}*`, '']
  let chapter = ''
  for (const a of list) {
    if (a.type === 'bookmark') continue
    if (a.chapter && a.chapter !== chapter) {
      chapter = a.chapter
      lines.push(`## ${chapter}`, '')
    }
    lines.push(`> ${a.text.replace(/\s+/g, ' ')}`, '')
    if (a.note) lines.push(a.note, '')
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '')} - highlights.md`
  link.click()
  URL.revokeObjectURL(url)
}

export function AnnotationsPanel({ annotations, title, author, initialTab = 'all', onGo, onEditNote, onDelete }: {
  annotations: Annotation[]
  title: string
  author: string
  initialTab?: Tab
  onGo: (cfi: string) => void
  onEditNote: (a: Annotation) => void
  onDelete: (a: Annotation) => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [color, setColor] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const sorted = useMemo(
    () => [...annotations].sort((a, b) => compareCFI(a.cfi, b.cfi) || a.created_at - b.created_at),
    [annotations],
  )
  const needle = q.trim().toLowerCase()
  const shown = sorted.filter((a) =>
    (tab === 'all' || a.type === tab) &&
    (!color || a.color === color) &&
    (!needle || `${a.text} ${a.note} ${a.chapter}`.toLowerCase().includes(needle)))

  const count = (t: Tab) => (t === 'all' ? annotations.length : annotations.filter((a) => a.type === t).length)

  return (
    <>
      <div className="tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABEL[t]} <span className="count">{count(t)}</span>
          </button>
        ))}
      </div>
      <input className="field" placeholder="Search your highlights and notes" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="dots">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.id}
            className={`swatch ${color === c.id ? 'active' : ''}`}
            style={{ background: c.hex }}
            title={`Only ${c.label.toLowerCase()}`}
            onClick={() => setColor(color === c.id ? null : c.id)}
          />
        ))}
        <span className="spacer" />
        <button className="menu-btn" onClick={() => exportMarkdown(title, author, sorted)}>
          <Download size={15} />Export
        </button>
      </div>

      {shown.length === 0 && (
        <p className="muted-r">
          {annotations.length ? 'Nothing matches these filters.' : 'Nothing here yet. Select any text while reading to highlight it.'}
        </p>
      )}

      {shown.map((a) => (
        <div
          key={a.id}
          className="anno"
          style={{ '--c': a.type === 'bookmark' ? 'var(--rmuted)' : colorHex(a.color) } as CSSProperties}
          onClick={() => onGo(a.cfi)}
        >
          <div className="anno-text">{a.text || 'Bookmark'}</div>
          {a.note && <div className="anno-note">{a.note}</div>}
          <div className="anno-meta">
            <span>{a.type === 'bookmark' ? 'Bookmark · ' : ''}{a.chapter}</span>
            <span className="spacer" />
            {a.type !== 'bookmark' && (
              <button className="icon-btn sm" title="Edit note" onClick={(e) => { e.stopPropagation(); onEditNote(a) }}>
                <StickyNote size={14} />
              </button>
            )}
            <button className="icon-btn sm" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(a) }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </>
  )
}

/* ---------- Reader settings ---------- */

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div className="setting"><div className="setting-label"><span>{label}</span></div>{children}</div>
}

function Slider({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void
}) {
  return (
    <div className="setting">
      <div className="setting-label"><span>{label}</span><span>{display}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function Seg<T extends string | number>({ options, value, onChange }: {
  options: [T, string][]; value: T; onChange: (v: T) => void
}) {
  return (
    <div className="seg-r">
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'active' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function SettingsPanel({ s, onChange }: { s: ReaderSettings; onChange: (p: Partial<ReaderSettings>) => void }) {
  return (
    <div>
      <Section label="Theme">
        <div className="themes">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <button
              key={id}
              className={`theme-btn ${s.theme === id ? 'active' : ''}`}
              style={{ background: THEMES[id].bg, color: THEMES[id].fg }}
              onClick={() => onChange({ theme: id })}
            >
              {THEMES[id].name}
            </button>
          ))}
        </div>
      </Section>
      <Section label="Font">
        <select className="field" value={s.font} onChange={(e) => onChange({ font: e.target.value })}>
          {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </Section>
      <Slider label="Font size" value={s.fontSize} min={12} max={36} step={1} display={`${s.fontSize}px`} onChange={(v) => onChange({ fontSize: v })} />
      <Slider label="Line spacing" value={s.lineHeight} min={1} max={2.4} step={0.05} display={s.lineHeight.toFixed(2)} onChange={(v) => onChange({ lineHeight: v })} />
      <Slider label="Side margins" value={s.gap} min={0} max={20} step={1} display={`${s.gap}%`} onChange={(v) => onChange({ gap: v })} />
      <Slider label="Column width" value={s.maxWidth} min={400} max={1400} step={20} display={`${s.maxWidth}px`} onChange={(v) => onChange({ maxWidth: v })} />
      <Section label="Layout">
        <Seg
          options={[[1, 'Single page'], [2, 'Two pages']] as [1 | 2, string][]}
          value={s.columns}
          onChange={(v) => onChange({ columns: v })}
        />
      </Section>
      <Section label="Reading mode">
        <Seg
          options={[['paginated', 'Pages'], ['scrolled', 'Scroll']] as ['paginated' | 'scrolled', string][]}
          value={s.flow}
          onChange={(v) => onChange({ flow: v })}
        />
      </Section>
      <Toggle label="Justify text" value={s.justify} onChange={(v) => onChange({ justify: v })} />
      <Toggle label="Hyphenation" value={s.hyphenate} onChange={(v) => onChange({ hyphenate: v })} />
      <Toggle label="Page turn animation" value={s.animated} onChange={(v) => onChange({ animated: v })} />
      <Toggle label="Show dictionary when selecting a word" value={s.autoDefine} onChange={(v) => onChange({ autoDefine: v })} />
    </div>
  )
}

/* ---------- Note editor ---------- */

export function NoteEditor({ annotation, onSave, onClose }: {
  annotation: Annotation; onSave: (note: string) => void; onClose: () => void
}) {
  const [note, setNote] = useState(annotation.note)
  return (
    <Modal title={annotation.note ? 'Edit note' : 'Add note'} onClose={onClose}>
      <blockquote className="quote">{annotation.text}</blockquote>
      <textarea
        className="note-area"
        autoFocus
        value={note}
        placeholder="Write your thoughts…"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(note) }}
      />
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave(note)}>Save note</button>
      </div>
    </Modal>
  )
}