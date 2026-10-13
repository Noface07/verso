import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Copy, ExternalLink, Volume2, X } from 'lucide-react'
import { LANGUAGES, baseLang, cleanWord, define, langName, translate, wikipedia } from '../lib/lookup'

export type LookupTab = 'define' | 'translate' | 'wiki'

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true })
  useEffect(() => {
    let alive = true
    setState({ loading: true })
    fn().then(
      (data) => { if (alive) setState({ loading: false, data }) },
      (e) => { if (alive) setState({ loading: false, error: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

function toNodes(node: Node, onLookup: (t: string) => void, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const kids = [...el.childNodes].map((c, i) => toNodes(c, onLookup, `${key}.${i}`))
  const href = el.tagName === 'A' ? el.getAttribute('href') ?? '' : ''
  if (href.startsWith('/wiki/') && !href.slice(6).includes(':')) {
    const term = decodeURIComponent(href.slice(6).split('#')[0]).replace(/_/g, ' ')
    return <button key={key} className="xref" onClick={() => onLookup(term)}>{kids}</button>
  }
  if (el.tagName === 'I' || el.tagName === 'EM') return <em key={key}>{kids}</em>
  if (el.tagName === 'B' || el.tagName === 'STRONG') return <strong key={key}>{kids}</strong>
  return <Fragment key={key}>{kids}</Fragment>
}

function RichText({ html, onLookup }: { html: string; onLookup: (t: string) => void }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const root = doc.body.firstElementChild
    return root ? [...root.childNodes].map((n, i) => toNodes(n, onLookup, String(i))) : null
  }, [html, onLookup])
  return <>{nodes}</>
}

function DefinePane({ term, lang, onLookup }: { term: string; lang: string; onLookup: (t: string) => void }) {
  const s = useAsync(() => define(term, lang), [term, lang])
  if (s.loading) return <p className="muted-r">Looking up “{cleanWord(term)}”…</p>
  if (!s.data) return <p className="muted-r">No definition found for “{cleanWord(term)}”.</p>
  const d = s.data
  return (
    <>
      <div className="lookup-word">
        <h4>{d.word}</h4>
        {d.phonetic && <span className="muted-r">{d.phonetic}</span>}
        {d.audio && (
          <button className="icon-btn sm" title="Play pronunciation" onClick={() => void new Audio(d.audio).play()}>
            <Volume2 size={14} />
          </button>
        )}
      </div>
      {d.groups.map((g, i) => (
        <div key={i} className="pos-group">
          <div className="pos">{g.partOfSpeech}</div>
          <ol>
            {g.senses.map((sense, j) => (
              <li key={j}>
                <RichText html={sense.html} onLookup={onLookup} />
                {sense.examples[0] && (
                  <div className="example"><RichText html={sense.examples[0]} onLookup={onLookup} /></div>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <div className="source">
        Source: {d.source}
        {d.source === 'Wiktionary' && (
          <a href={`https://en.wiktionary.org/wiki/${encodeURIComponent(d.word)}`} target="_blank" rel="noreferrer">
            Open <ExternalLink size={12} />
          </a>
        )}
      </div>
    </>
  )
}

function TranslatePane({ text, lang, to, onTo }: { text: string; lang: string; to: string; onTo: (l: string) => void }) {
  const src = baseLang(lang)
  const s = useAsync(() => translate(text, src, to), [text, src, to])
  return (
    <>
      <div className="tr-head">
        <span className="muted-r small">{langName(src)} →</span>
        <select className="field sm" value={to} onChange={(e) => onTo(e.target.value)}>
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
      {s.loading ? <p className="muted-r">Translating…</p>
        : s.error ? <p className="muted-r">{s.error}</p>
        : <p className="tr-out">{s.data}</p>}
      {text.length > 500 && <p className="muted-r small">Only the first 500 characters are translated.</p>}
      {s.data && (
        <button className="pop-btn wide" onClick={() => void navigator.clipboard.writeText(s.data ?? '')}>
          <Copy size={14} />Copy translation
        </button>
      )}
      <div className="source">Translation by MyMemory</div>
    </>
  )
}

function WikiPane({ term, lang }: { term: string; lang: string }) {
  const s = useAsync(() => wikipedia(term, lang), [term, lang])
  if (s.loading) return <p className="muted-r">Searching Wikipedia…</p>
  if (!s.data) return <p className="muted-r">No Wikipedia article found for “{term}”.</p>
  const w = s.data
  return (
    <>
      <div className="wiki">
        {w.thumbnail && <img className="wiki-thumb" src={w.thumbnail} alt="" />}
        <div>
          <h4>{w.title}</h4>
          <p>{w.extract}</p>
        </div>
      </div>
      <div className="source">
        Source: Wikipedia
        <a href={w.url} target="_blank" rel="noreferrer">Read more <ExternalLink size={12} /></a>
      </div>
    </>
  )
}

export function LookupCard({ text, tab, onTab, lang, translateTo, onTranslateTo, onSpeak, onClose }: {
  text: string
  tab: LookupTab
  onTab: (t: LookupTab) => void
  lang: string
  translateTo: string
  onTranslateTo: (l: string) => void
  onSpeak: (text: string) => void
  onClose: () => void
}) {
  const [term, setTerm] = useState(text)
  const isShort = cleanWord(term).split(/\s+/).length <= 3
  const tabs: [LookupTab, string][] = [['define', 'Dictionary'], ['translate', 'Translate'], ['wiki', 'Wikipedia']]

  return (
    <div className="lookup">
      <div className="lookup-tabs">
        {tabs.map(([t, label]) => (
          <button key={t} className={`lookup-tab ${tab === t ? 'active' : ''}`} onClick={() => onTab(t)}>{label}</button>
        ))}
        <span className="spacer" />
        <button className="icon-btn sm" title="Pronounce" onClick={() => onSpeak(tab === 'define' ? term : text)}><Volume2 size={15} /></button>
        <button className="icon-btn sm" title="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="lookup-body">
        {tab === 'define' && (isShort
          ? <DefinePane term={term} lang={lang} onLookup={setTerm} />
          : <p className="muted-r">Select a single word to see its definition.</p>)}
        {tab === 'translate' && <TranslatePane text={text} lang={lang} to={translateTo} onTo={onTranslateTo} />}
        {tab === 'wiki' && <WikiPane term={isShort ? term : text.split(/\s+/).slice(0, 6).join(' ')} lang={lang} />}
      </div>
    </div>
  )
}