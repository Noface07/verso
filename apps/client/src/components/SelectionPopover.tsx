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
  const width = Math.min(390, window.innerWidth - 16);
  const left = Math.min(Math.max(anchor.x - width / 2, 8), window.innerWidth - width - 8);
  const needed = lookup ? 420 : 130;
  const above = anchor.top > needed + 56;
  const pos = above ? { bottom: window.innerHeight - anchor.top + 10 } : { top: anchor.bottom + 10 };

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
      onExpand={props.onExpandLookup}
    />
  );

  const toggle = (t: LookupTab) => props.onLookup(lookup === t ? null : t);

  return (
    <div
      className="fixed z-50 rounded-[var(--r-lg)] bg-[var(--layer-solid)] text-[var(--text-1)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)] overflow-hidden select-none animate-in fade-in-0 duration-150"
      style={{ left, width, ...pos }}
    >
      {above && card}

      {/* Row 1: 6 Color dots + 4 style selectors */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--stroke)] bg-[var(--layer-1)]">
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
      <div className="flex items-center justify-around px-2 py-1.5 bg-[var(--layer-solid)]">
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