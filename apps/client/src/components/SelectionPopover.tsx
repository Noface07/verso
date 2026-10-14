import React, { useEffect } from 'react';
import {
  BookA,
  Bookmark,
  Copy,
  Globe,
  Highlighter,
  Languages,
  Search,
  StickyNote,
  Strikethrough,
  Trash2,
  Underline,
  Volume2,
  Waves,
  Quote,
} from 'lucide-react';
import type { HighlightStyle } from '../db';
import { HIGHLIGHT_COLORS } from '../lib/readerSettings';
import { LookupCard, type LookupTab } from './LookupCard';
import { define } from '../lib/lookup';
import { IconButton } from '../design/components/IconButton';

export interface MenuAnchor {
  x: number;
  top: number;
  bottom: number;
}

const STYLES: { id: HighlightStyle; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikethrough', label: 'Strikethrough', icon: Strikethrough },
  { id: 'squiggly', label: 'Squiggly', icon: Waves },
];

export function SelectionPopover(props: {
  anchor: MenuAnchor;
  text: string;
  color: string;
  style: HighlightStyle;
  existing: boolean;
  hasNote: boolean;
  lookup: LookupTab | null;
  lang: string;
  translateTo: string;
  onLookup: (tab: LookupTab | null) => void;
  onTranslateTo: (lang: string) => void;
  onSpeakText: (text: string) => void;
  onColor: (color: string) => void;
  onStyle: (style: HighlightStyle) => void;
  onNote: () => void;
  onBookmark: () => void;
  onReadAloud: () => void;
  onSearch: () => void;
  onCopy: () => void;
  onDelete?: () => void;
  onExpandLookup?: () => void;
  onShareQuote?: () => void;
}) {
  const { anchor, lookup } = props;

  // Warm the dictionary as soon as a single word is selected, so by the time the
  // reader taps "Define" the answer is usually already cached.
  const { text, lang } = props;
  useEffect(() => {
    const word = text.trim();
    if (!word || word.length > 40 || /\s/.test(word)) return;
    const timer = setTimeout(() => void define(word, lang).catch(() => {}), 250);
    return () => clearTimeout(timer);
  }, [text, lang]);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = 8;
  const GAP = 10;
  const width = Math.min(390, vw - M * 2);
  const left = Math.min(Math.max(anchor.x - width / 2, M), vw - width - M);
  const needed = lookup ? 420 : 130;
  const spaceAbove = anchor.top - GAP - M;
  const spaceBelow = vh - anchor.bottom - GAP - M;

  let above: boolean;
  let maxHeight: number;
  let pos: React.CSSProperties;
  if (lookup && vw < 640 && Math.max(spaceAbove, spaceBelow) < needed) {
    // Phone, dictionary open, no room beside the selection: dock to the other half.
    const selectionInTopHalf = (anchor.top + anchor.bottom) / 2 < vh / 2;
    above = selectionInTopHalf; // docked at the bottom: card on top, tools nearest the thumb
    maxHeight = Math.round(vh / 2) - M;
    pos = selectionInTopHalf ? { bottom: M } : { top: M };
  } else {
    above = spaceAbove >= needed || (spaceBelow < needed && spaceAbove > spaceBelow);
    maxHeight = Math.max(140, above ? spaceAbove : spaceBelow);
    pos = above ? { bottom: vh - anchor.top + GAP } : { top: anchor.bottom + GAP };
  }

  const card = lookup && (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
        onExpand={props.onExpandLookup}
      />
    </div>
  );

  const toggle = (t: LookupTab) => props.onLookup(lookup === t ? null : t);

  return (
    <div
      className="fixed z-50 flex flex-col rounded-[var(--r-lg)] bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] overflow-hidden select-none animate-in fade-in-0 duration-150"
      style={{ left, width, maxHeight, ...pos }}
    >
      {above && card}

      {/* Row 1: 6 Color dots + 4 style selectors */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--stroke)] bg-[var(--layer-1)]">
        <div className="flex items-center gap-2">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              aria-label={`${c.label} highlight`}
              onClick={() => props.onColor(c.id)}
              className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-115 flex items-center justify-center ${
                props.existing && props.color === c.id
                  ? 'ring-2 ring-[var(--text-1)] ring-offset-2 ring-offset-[var(--layer-solid)] scale-110'
                  : ''
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>

        <div className="h-4 w-[1px] bg-[var(--stroke)]" />

        <div className="flex items-center gap-1">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.label}
              aria-label={s.label}
              onClick={() => props.onStyle(s.id)}
              className={`p-1 rounded-[var(--r-sm)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-2)] cursor-pointer ${
                props.style === s.id ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold' : ''
              }`}
            >
              <s.icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: 9 Action tool icons */}
      <div className="shrink-0 flex items-center justify-around px-2 py-1.5 bg-[var(--layer-solid)]">
        <IconButton
          label={props.hasNote ? 'Edit note' : 'Add note'}
          icon={<StickyNote className={`w-4 h-4 ${props.hasNote ? 'text-[var(--accent)]' : ''}`} />}
          size="sm"
          onClick={props.onNote}
        />
        <IconButton
          label="Bookmark here"
          icon={<Bookmark className="w-4 h-4" />}
          size="sm"
          onClick={props.onBookmark}
        />
        <IconButton
          label="Dictionary"
          icon={<BookA className={`w-4 h-4 ${lookup === 'define' ? 'text-[var(--accent)]' : ''}`} />}
          size="sm"
          onClick={() => toggle('define')}
        />
        <IconButton
          label="Translate"
          icon={<Languages className={`w-4 h-4 ${lookup === 'translate' ? 'text-[var(--accent)]' : ''}`} />}
          size="sm"
          onClick={() => toggle('translate')}
        />
        <IconButton
          label="Wikipedia"
          icon={<Globe className={`w-4 h-4 ${lookup === 'wiki' ? 'text-[var(--accent)]' : ''}`} />}
          size="sm"
          onClick={() => toggle('wiki')}
        />
        <IconButton
          label="Read aloud"
          icon={<Volume2 className="w-4 h-4" />}
          size="sm"
          onClick={props.onReadAloud}
        />
        <IconButton
          label="Search in book"
          icon={<Search className="w-4 h-4" />}
          size="sm"
          onClick={props.onSearch}
        />
        <IconButton
          label="Copy text"
          icon={<Copy className="w-4 h-4" />}
          size="sm"
          onClick={props.onCopy}
        />
        {props.onShareQuote && (
          <IconButton
            label="Share quote card"
            icon={<Quote className="w-4 h-4" />}
            size="sm"
            onClick={props.onShareQuote}
          />
        )}
        {props.onDelete && (
          <IconButton
            label="Delete highlight"
            icon={<Trash2 className="w-4 h-4" />}
            size="sm"
            variant="danger"
            onClick={props.onDelete}
          />
        )}
      </div>

      {!above && card}
    </div>
  );
}