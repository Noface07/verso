import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, Volume2, X, Maximize2 } from 'lucide-react';
import { LANGUAGES, baseLang, cleanWord, define, langName, translate, wikipedia } from '../lib/lookup';
import { IconButton } from '../design/components/IconButton';
import { SegmentedControl } from '../design/components/SegmentedControl';

export type LookupTab = 'define' | 'translate' | 'wiki';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => { if (alive) setState({ loading: false, data }); },
      (e) => { if (alive) setState({ loading: false, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function toNodes(node: Node, onLookup: (t: string) => void, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const kids = [...el.childNodes].map((c, i) => toNodes(c, onLookup, `${key}.${i}`));
  const href = el.tagName === 'A' ? el.getAttribute('href') ?? '' : '';
  if (href.startsWith('/wiki/') && !href.slice(6).includes(':')) {
    const term = decodeURIComponent(href.slice(6).split('#')[0]).replace(/_/g, ' ');
    return (
      <button
        key={key}
        type="button"
        className="text-[var(--accent)] underline hover:text-[var(--accent-hover)] cursor-pointer"
        onClick={() => onLookup(term)}
      >
        {kids}
      </button>
    );
  }
  if (el.tagName === 'I' || el.tagName === 'EM') return <em key={key}>{kids}</em>;
  if (el.tagName === 'B' || el.tagName === 'STRONG') return <strong key={key}>{kids}</strong>;
  return <Fragment key={key}>{kids}</Fragment>;
}

function RichText({ html, onLookup }: { html: string; onLookup: (t: string) => void }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    return root ? [...root.childNodes].map((n, i) => toNodes(n, onLookup, String(i))) : null;
  }, [html, onLookup]);
  return <>{nodes}</>;
}

function DefinePane({ term, lang, onLookup }: { term: string; lang: string; onLookup: (t: string) => void }) {
  const s = useAsync(() => define(term, lang), [term, lang]);
  if (s.loading) return <p className="text-xs text-[var(--text-3)] p-3">Looking up “{cleanWord(term)}”…</p>;
  if (!s.data) return <p className="text-xs text-[var(--text-3)] p-3">No definition found for “{cleanWord(term)}”.</p>;
  const d = s.data;
  return (
    <div className="space-y-3 p-3 max-h-[220px] overflow-y-auto text-xs">
      <div className="flex items-baseline gap-2">
        <h4 className="text-base font-bold text-[var(--text-1)] capitalize">{d.word}</h4>
        {d.phonetic && <span className="text-xs text-[var(--text-3)]">{d.phonetic}</span>}
        {d.audio && (
          <IconButton
            label="Pronounce"
            size="sm"
            icon={<Volume2 className="w-3.5 h-3.5" />}
            onClick={() => void new Audio(d.audio).play()}
          />
        )}
      </div>
      {d.groups.map((m, i) => (
        <div key={i} className="space-y-1">
          <span className="font-semibold text-[11px] text-[var(--accent)] uppercase tracking-wider">{m.partOfSpeech}</span>
          <ol className="list-decimal list-inside space-y-1 pl-1 text-[var(--text-1)]">
            {m.senses.slice(0, 3).map((def, j) => (
              <li key={j} className="leading-relaxed">
                <RichText html={def.html} onLookup={onLookup} />
                {def.examples[0] && <p className="text-[var(--text-3)] italic mt-0.5">“{def.examples[0]}”</p>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TranslatePane({
  text,
  from,
  to,
  onSpeak,
}: {
  text: string;
  from: string;
  to: string;
  onSpeak: (t: string) => void;
}) {
  const s = useAsync(() => translate(text, from, to), [text, from, to]);
  if (s.loading) return <p className="text-xs text-[var(--text-3)] p-3">Translating…</p>;
  if (!s.data) return <p className="text-xs text-[var(--danger)] p-3">Translation failed: {s.error}</p>;
  const t = s.data;
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="p-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] leading-relaxed">
        {t}
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--text-3)]">
        <span>From {langName(from)} to {langName(to)}</span>
        <div className="flex items-center gap-1">
          <IconButton label="Speak" size="sm" icon={<Volume2 className="w-3.5 h-3.5" />} onClick={() => onSpeak(t)} />
          <IconButton label="Copy" size="sm" icon={<Copy className="w-3.5 h-3.5" />} onClick={() => void navigator.clipboard.writeText(t)} />
        </div>
      </div>
    </div>
  );
}

function WikiPane({ term, lang }: { term: string; lang: string }) {
  const s = useAsync(() => wikipedia(term, lang), [term, lang]);
  if (s.loading) return <p className="text-xs text-[var(--text-3)] p-3">Searching Wikipedia…</p>;
  if (!s.data) return <p className="text-xs text-[var(--text-3)] p-3">No Wikipedia article found for “{term}”.</p>;
  const w = s.data;
  return (
    <div className="space-y-2.5 p-3 max-h-[220px] overflow-y-auto text-xs">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-[var(--text-1)]">{w.title}</h4>
        {w.url && (
          <a
            href={w.url}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
          >
            Read more <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="text-[var(--text-2)] leading-relaxed">
        <p>{w.extract}</p>
      </div>
    </div>
  );
}

export function LookupCard({
  text,
  tab,
  onTab,
  lang,
  translateTo,
  onTranslateTo,
  onSpeak,
  onClose,
  onExpand,
}: {
  text: string;
  tab: LookupTab;
  onTab: (tab: LookupTab | null) => void;
  lang: string;
  translateTo: string;
  onTranslateTo: (lang: string) => void;
  onSpeak: (text: string) => void;
  onClose: () => void;
  onExpand?: () => void;
}) {
  const [currentTab, setCurrentTab] = useState<LookupTab>(tab);

  return (
    <div className="flex flex-col border-b border-[var(--stroke)] bg-[var(--layer-solid)] text-[var(--text-1)] select-none">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--stroke)]">
        <SegmentedControl
          size="sm"
          options={[
            { value: 'define', label: 'Define' },
            { value: 'translate', label: 'Translate' },
            { value: 'wiki', label: 'Wikipedia' },
          ]}
          value={currentTab}
          onChange={(val) => {
            setCurrentTab(val);
            onTab(val);
          }}
        />

        <div className="flex items-center gap-1">
          {currentTab === 'translate' && (
            <select
              value={translateTo}
              onChange={(e) => onTranslateTo(e.target.value)}
              className="h-6 text-[11px] rounded-[var(--r-sm)] bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] px-1 outline-none"
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {onExpand && (
            <IconButton label="Expand to side panel" icon={<Maximize2 className="w-3.5 h-3.5" />} size="sm" onClick={onExpand} />
          )}

          <IconButton label="Close lookup" icon={<X className="w-3.5 h-3.5" />} size="sm" onClick={onClose} />
        </div>
      </div>

      <div>
        {currentTab === 'define' && <DefinePane term={text} lang={lang} onLookup={() => onTab('define')} />}
        {currentTab === 'translate' && (
          <TranslatePane text={text} from={baseLang(lang)} to={translateTo} onSpeak={onSpeak} />
        )}
        {currentTab === 'wiki' && <WikiPane term={text} lang={baseLang(lang)} />}
      </div>
    </div>
  );
}