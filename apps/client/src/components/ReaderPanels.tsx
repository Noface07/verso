import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, StickyNote, Search, Upload, Trash2, Moon, Sun } from 'lucide-react';
import type { Annotation } from '../db';
import { compareCFI, type FoliateView, type SearchHit, type TocItem } from '../lib/foliate';
import { FONTS, THEMES, colorHex, type ReaderSettings, type ThemeId, type PageAnimation } from '../lib/readerSettings';
import { useCustomFonts } from '../lib/customFonts';
import { Dialog } from '../design/components/Dialog';
import { Button } from '../design/components/Button';
import { SegmentedControl } from '../design/components/SegmentedControl';
import { Switch } from '../design/components/Switch';
import { Slider } from '../design/components/Slider';
import { ProgressBar } from '../design/components/Progress';

/* ---------- Table of contents ---------- */

export function TocPanel({ toc, current, onGo }: { toc: TocItem[]; current?: string; onGo: (href: string) => void }) {
  if (!toc.length) return <p className="text-xs text-[var(--text-3)] p-4">This book has no table of contents.</p>;
  return (
    <nav className="py-2 text-sm">
      <TocList items={toc} current={current} onGo={onGo} depth={0} />
    </nav>
  );
}

function TocList({
  items,
  current,
  onGo,
  depth,
}: {
  items: TocItem[];
  current?: string;
  onGo: (href: string) => void;
  depth: number;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((it, i) => (
        <li key={`${it.href}-${i}`}>
          <button
            type="button"
            className={`w-full text-left py-2 pr-3 rounded-[var(--r-sm)] transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] text-xs truncate ${
              it.href === current
                ? 'bg-[var(--layer-3)] text-[var(--accent)] font-semibold'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--layer-2)]'
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => onGo(it.href)}
          >
            {it.label?.trim() || 'Untitled'}
          </button>
          {it.subitems?.length ? (
            <TocList items={it.subitems} current={current} onGo={onGo} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Full-text search ---------- */

export function SearchPanel({ view, initial, onGo }: { view: FoliateView; initial: string; onGo: (cfi: string) => void }) {
  const [query, setQuery] = useState(initial);
  const [groups, setGroups] = useState<{ label: string; hits: SearchHit[] }[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);
  const run = useRef(0);

  async function search(q: string) {
    const id = ++run.current;
    view.clearSearch();
    setGroups([]);
    setSearched(false);
    if (!q.trim()) {
      setProgress(null);
      return;
    }
    setProgress(0);
    for await (const ev of view.search({ query: q.trim() })) {
      if (id !== run.current) return;
      if (ev === 'done') break;
      if ('progress' in ev) setProgress(ev.progress);
      else if (ev.subitems?.length) {
        const hits = ev.subitems;
        setGroups((g) => [...g, { label: ev.label ?? '', hits }]);
      }
    }
    if (id === run.current) {
      setProgress(null);
      setSearched(true);
    }
  }

  useEffect(() => {
    if (initial) void search(initial);
    return () => {
      run.current++;
      view.clearSearch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  return (
    <div className="space-y-4 p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <div className="flex items-center h-9 px-2.5 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-sm text-[var(--text-1)] gap-2">
          <Search className="w-4 h-4 text-[var(--text-3)] shrink-0" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-[var(--text-3)] text-xs"
            placeholder="Search in book…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </form>

      {progress !== null && <ProgressBar value={Math.round(progress * 100)} height={2} />}

      {searched && (
        <p className="text-xs text-[var(--text-3)]">
          {total ? `${total} result${total === 1 ? '' : 's'}` : 'No results found'}
        </p>
      )}

      <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
        {groups.map((g, i) => (
          <div key={i} className="space-y-1.5">
            {g.label && <div className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-wider">{g.label}</div>}
            {g.hits.map((h) => (
              <button
                key={h.cfi}
                type="button"
                className="w-full text-left p-2 rounded-[var(--r-sm)] bg-[var(--layer-1)] hover:bg-[var(--layer-2)] border border-[var(--stroke)] text-xs text-[var(--text-2)] cursor-pointer leading-relaxed transition-colors"
                onClick={() => onGo(h.cfi)}
              >
                …{h.excerpt.pre}
                <mark className="bg-[var(--accent-soft)] text-[var(--accent)] rounded-xs px-0.5 font-semibold">
                  {h.excerpt.match}
                </mark>
                {h.excerpt.post}…
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Highlights, notes, bookmarks ---------- */

type Tab = 'all' | 'highlight' | 'note' | 'bookmark';
const TAB_LABEL: Record<Tab, string> = {
  all: 'All',
  highlight: 'Highlights',
  note: 'Notes',
  bookmark: 'Bookmarks',
};

function exportMarkdown(title: string, author: string, list: Annotation[]) {
  const lines = [`# ${title}`, `*${author}*`, ''];
  let chapter = '';
  for (const a of list) {
    if (a.chapter && a.chapter !== chapter) {
      chapter = a.chapter;
      lines.push(`\n## ${chapter}\n`);
    }
    if (a.type === 'bookmark') {
      lines.push(`- 🔖 **Bookmark**: *${a.text || 'Page'}* (${a.cfi})`);
    } else {
      lines.push(`> ${a.text}`);
      if (a.note) lines.push(`\n> **Note**: ${a.note}`);
      lines.push('');
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title} — Highlights.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AnnotationsPanel({
  initialTab = 'all',
  annotations,
  title,
  author,
  onGo,
  onEditNote,
  onDelete,
}: {
  initialTab?: Tab;
  annotations: Annotation[];
  title: string;
  author: string;
  onGo: (cfi: string) => void;
  onEditNote: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const active = useMemo(
    () =>
      annotations
        .filter((a) => !a.deleted_at && (tab === 'all' || a.type === tab))
        .sort((x, y) => compareCFI(x.cfi, y.cfi) || x.created_at - y.created_at),
    [annotations, tab],
  );

  return (
    <div className="space-y-3 p-2">
      <div className="flex items-center justify-between">
        <SegmentedControl
          size="sm"
          options={[
            { value: 'all', label: 'All' },
            { value: 'highlight', label: 'Highlights' },
            { value: 'note', label: 'Notes' },
            { value: 'bookmark', label: 'Bookmarks' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {active.length > 0 && (
          <Button
            size="sm"
            variant="subtle"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={() => exportMarkdown(title, author, active)}
          >
            Export
          </Button>
        )}
      </div>

      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-200px)]">
        {active.length === 0 ? (
          <p className="text-xs text-[var(--text-3)] p-4 text-center">
            No {TAB_LABEL[tab].toLowerCase()} yet.
          </p>
        ) : (
          active.map((a) => {
            const hex = colorHex(a.color);
            return (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                className="relative flex flex-col gap-1.5 p-3 rounded-[var(--r-md)] bg-[var(--layer-1)] hover:bg-[var(--layer-2)] border border-[var(--stroke)] text-left cursor-pointer transition-colors"
                onClick={() => onGo(a.cfi)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onGo(a.cfi)}
              >
                {a.type !== 'bookmark' && (
                  <div
                    className="absolute left-1 top-3 bottom-3 w-1 rounded-full"
                    style={{ backgroundColor: hex }}
                  />
                )}
                <div className="pl-2 space-y-1">
                  <div className="text-xs text-[var(--text-1)] line-clamp-3 leading-relaxed">
                    {a.text || (a.type === 'bookmark' ? 'Bookmark' : '')}
                  </div>
                  {a.note && (
                    <div className="flex items-start gap-1.5 text-[11px] text-[var(--text-2)] bg-[var(--layer-2)] p-1.5 rounded-[var(--r-sm)]">
                      <StickyNote className="w-3 h-3 text-[var(--accent)] shrink-0 mt-0.5" />
                      <span>{a.note}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-3)] pt-1">
                    <span>{a.chapter || 'Chapter'}</span>
                    <div className="flex items-center gap-2">
                      {a.type !== 'bookmark' && (
                        <button
                          type="button"
                          className="hover:text-[var(--accent)] cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditNote(a);
                          }}
                        >
                          {a.note ? 'Edit note' : 'Add note'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="hover:text-[var(--danger)] cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(a);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ---------- Reader settings ---------- */

export function SettingsPanel({
  s,
  onChange,
}: {
  s: ReaderSettings;
  onChange: (p: Partial<ReaderSettings>) => void;
}) {
  const { fonts: customFonts, importFont, removeFont } = useCustomFonts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'theme' | 'typography' | 'layout'>('theme');

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const record = await importFont(file);
      onChange({ font: record.name });
    } catch (err) {
      alert(`Failed to import font: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 p-3 text-xs text-[var(--text-1)]">
      {/* Sub-navigation tabs */}
      <SegmentedControl
        size="sm"
        options={[
          { value: 'theme', label: 'Theme' },
          { value: 'typography', label: 'Fonts & Text' },
          { value: 'layout', label: 'Layout & Motion' },
        ]}
        value={activeTab}
        onChange={(val) => setActiveTab(val as 'theme' | 'typography' | 'layout')}
      />

      {/* TAB 1: Theme & Lighting */}
      {activeTab === 'theme' && (
        <div className="space-y-4 animate-fade-in">
          {/* Preset Themes Grid */}
          <div className="space-y-2">
            <span className="font-semibold text-[11px] text-[var(--text-3)] uppercase tracking-wider">
              Reading Theme
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(THEMES) as Exclude<ThemeId, 'custom'>[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`h-9 rounded-[var(--r-md)] border text-xs font-medium cursor-pointer transition-transform hover:scale-102 flex items-center justify-center ${
                    s.theme === id
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                      : 'border-[var(--stroke)]'
                  }`}
                  style={{ background: THEMES[id].bg, color: THEMES[id].fg }}
                  onClick={() => onChange({ theme: id })}
                >
                  {THEMES[id].name}
                </button>
              ))}
              <button
                type="button"
                className={`h-9 rounded-[var(--r-md)] border text-xs font-medium cursor-pointer transition-transform hover:scale-102 flex items-center justify-center ${
                  s.theme === 'custom'
                    ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                    : 'border-[var(--stroke)]'
                }`}
                style={{
                  background: s.customTheme?.bg || '#fbfbf8',
                  color: s.customTheme?.fg || '#1f1f1f',
                }}
                onClick={() => onChange({ theme: 'custom' })}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Custom Theme Editor */}
          {s.theme === 'custom' && (
            <div className="p-3 rounded-[var(--r-lg)] bg-[var(--layer-2)] border border-[var(--stroke)] space-y-2.5">
              <span className="font-semibold text-[11px] text-[var(--accent)] uppercase tracking-wider block">
                Custom Palette
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="custom-palette-bg" className="text-[10px] text-[var(--text-3)] block mb-1">Background</label>
                  <input
                    id="custom-palette-bg"
                    type="color"
                    value={s.customTheme?.bg || '#fbfbf8'}
                    onChange={(e) =>
                      onChange({
                        customTheme: {
                          ...(s.customTheme || { name: 'Custom', link: '#2563eb', dark: false }),
                          bg: e.target.value,
                          name: 'Custom',
                          fg: s.customTheme?.fg || '#1f1f1f',
                        },
                      })
                    }
                    className="w-full h-8 rounded-[var(--r-sm)] border border-[var(--stroke)] bg-transparent cursor-pointer"
                  />
                </div>
                <div>
                  <label htmlFor="custom-palette-fg" className="text-[10px] text-[var(--text-3)] block mb-1">Text</label>
                  <input
                    id="custom-palette-fg"
                    type="color"
                    value={s.customTheme?.fg || '#1f1f1f'}
                    onChange={(e) =>
                      onChange({
                        customTheme: {
                          ...(s.customTheme || { name: 'Custom', link: '#2563eb', dark: false }),
                          fg: e.target.value,
                          name: 'Custom',
                          bg: s.customTheme?.bg || '#fbfbf8',
                        },
                      })
                    }
                    className="w-full h-8 rounded-[var(--r-sm)] border border-[var(--stroke)] bg-transparent cursor-pointer"
                  />
                </div>
                <div>
                  <label htmlFor="custom-palette-link" className="text-[10px] text-[var(--text-3)] block mb-1">Links</label>
                  <input
                    id="custom-palette-link"
                    type="color"
                    value={s.customTheme?.link || '#2563eb'}
                    onChange={(e) =>
                      onChange({
                        customTheme: {
                          ...(s.customTheme || { name: 'Custom', bg: '#fbfbf8', fg: '#1f1f1f', dark: false }),
                          link: e.target.value,
                          name: 'Custom',
                        },
                      })
                    }
                    className="w-full h-8 rounded-[var(--r-sm)] border border-[var(--stroke)] bg-transparent cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Match App Theme Toggle */}
          <Switch
            label="Match app dark / light theme"
            checked={s.matchAppTheme}
            onCheckedChange={(val) => onChange({ matchAppTheme: val })}
          />

          {/* Night Light Amber Overlay */}
          <div className="space-y-1.5 pt-2 border-t border-[var(--stroke)]">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)] flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-[var(--warning)]" /> Night Light (Warm Tint)
              </span>
              <span className="text-[var(--text-3)]">{s.nightLight}%</span>
            </div>
            <Slider
              value={[s.nightLight]}
              min={0}
              max={40}
              step={2}
              onValueChange={([val]) => onChange({ nightLight: val })}
            />
          </div>

          {/* Dim Overlay for Night Reading */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)] flex items-center gap-1.5">
                <Moon className="w-3.5 h-3.5 text-[var(--accent)]" /> Reduce Brightness
              </span>
              <span className="text-[var(--text-3)]">{s.dimOverlay}%</span>
            </div>
            <Slider
              value={[s.dimOverlay]}
              min={0}
              max={60}
              step={2}
              onValueChange={([val]) => onChange({ dimOverlay: val })}
            />
          </div>
        </div>
      )}

      {/* TAB 2: Typography */}
      {activeTab === 'typography' && (
        <div className="space-y-4 animate-fade-in">
          {/* Font Family Selection */}
          <div className="space-y-1.5">
            <span className="font-semibold text-[11px] text-[var(--text-3)] uppercase tracking-wider">
              Typeface
            </span>
            <select
              value={s.font}
              onChange={(e) => onChange({ font: e.target.value })}
              className="w-full h-8 px-2 text-xs rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none cursor-pointer"
            >
              <optgroup label="Bundled Fonts">
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
              {customFonts.length > 0 && (
                <optgroup label="Custom Imported Fonts">
                  {customFonts.map((cf) => (
                    <option key={cf.id} value={cf.name}>
                      {cf.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Import Custom Font Button */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".ttf,.otf,.woff2,.woff"
              onChange={handleFontUpload}
              className="hidden"
            />
            <Button
              variant="standard"
              size="sm"
              icon={<Upload className="w-3.5 h-3.5" />}
              onClick={() => fileInputRef.current?.click()}
              className="w-full justify-center text-xs"
            >
              Import Custom Font (.ttf, .otf, .woff2)
            </Button>
          </div>

          {/* List of Custom Fonts with Delete */}
          {customFonts.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] text-[var(--text-3)]">Installed custom fonts:</span>
              <div className="space-y-1">
                {customFonts.map((cf) => (
                  <div
                    key={cf.id}
                    className="flex items-center justify-between px-2 py-1 rounded-[var(--r-sm)] bg-[var(--layer-2)] text-[11px]"
                  >
                    <span className="truncate">{cf.name}</span>
                    <button
                      type="button"
                      onClick={() => void removeFont(cf.id)}
                      className="text-[var(--danger)] hover:opacity-80 p-0.5 cursor-pointer"
                      title="Remove font"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Font Size */}
          <div className="space-y-1.5 pt-2 border-t border-[var(--stroke)]">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)]">Font size</span>
              <span className="text-[var(--text-3)]">{s.fontSize}px</span>
            </div>
            <Slider
              value={[s.fontSize]}
              min={12}
              max={36}
              step={1}
              onValueChange={([val]) => onChange({ fontSize: val })}
            />
          </div>

          {/* Line Height */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)]">Line height</span>
              <span className="text-[var(--text-3)]">{s.lineHeight.toFixed(2)}</span>
            </div>
            <Slider
              value={[s.lineHeight]}
              min={1}
              max={2.4}
              step={0.05}
              onValueChange={([val]) => onChange({ lineHeight: val })}
            />
          </div>

          {/* Paragraph Spacing */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)]">Paragraph spacing</span>
              <span className="text-[var(--text-3)]">{s.paragraphSpacing}px</span>
            </div>
            <Slider
              value={[s.paragraphSpacing]}
              min={0}
              max={24}
              step={2}
              onValueChange={([val]) => onChange({ paragraphSpacing: val })}
            />
          </div>

          {/* First Line Indent */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)]">First line indent</span>
              <span className="text-[var(--text-3)]">{s.firstLineIndent}px</span>
            </div>
            <Slider
              value={[s.firstLineIndent]}
              min={0}
              max={32}
              step={4}
              onValueChange={([val]) => onChange({ firstLineIndent: val })}
            />
          </div>

          {/* Word Spacing */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)]">Word spacing</span>
              <span className="text-[var(--text-3)]">{s.wordSpacing}px</span>
            </div>
            <Slider
              value={[s.wordSpacing]}
              min={-2}
              max={8}
              step={1}
              onValueChange={([val]) => onChange({ wordSpacing: val })}
            />
          </div>

          {/* Letter Spacing */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-[var(--text-2)]">Letter spacing</span>
              <span className="text-[var(--text-3)]">{s.letterSpacing}px</span>
            </div>
            <Slider
              value={[s.letterSpacing]}
              min={-1}
              max={4}
              step={0.5}
              onValueChange={([val]) => onChange({ letterSpacing: val })}
            />
          </div>

          {/* Bold text & Override Publisher switches */}
          <div className="space-y-3 pt-2 border-t border-[var(--stroke)]">
            <Switch
              label="Bold text"
              checked={s.boldText}
              onCheckedChange={(val) => onChange({ boldText: val })}
            />
            <Switch
              label="Override publisher fonts & colours"
              checked={s.overridePublisher}
              onCheckedChange={(val) => onChange({ overridePublisher: val })}
            />
          </div>
        </div>
      )}

      {/* TAB 3: Layout & Motion */}
      {activeTab === 'layout' && (
        <div className="space-y-4 animate-fade-in">
          {/* Columns */}
          <div className="space-y-2">
            <span className="font-semibold text-[11px] text-[var(--text-3)] uppercase tracking-wider">
              Layout Columns
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: '1', label: 'Single page' },
                { value: '2', label: 'Two pages' },
              ]}
              value={String(s.columns)}
              onChange={(val) => onChange({ columns: Number(val) as 1 | 2 })}
            />
          </div>

          {/* Reading Flow */}
          <div className="space-y-2">
            <span className="font-semibold text-[11px] text-[var(--text-3)] uppercase tracking-wider">
              Flow Mode
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'paginated', label: 'Paginated' },
                { value: 'scrolled', label: 'Continuous scroll' },
              ]}
              value={s.flow}
              onChange={(val) => onChange({ flow: val as 'paginated' | 'scrolled' })}
            />
          </div>

          {/* Page Turn Animation */}
          <div className="space-y-2">
            <span className="font-semibold text-[11px] text-[var(--text-3)] uppercase tracking-wider">
              Page Turn Animation
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'none', label: 'None' },
                { value: 'slide', label: 'Slide' },
                { value: 'fade', label: 'Fade' },
              ]}
              value={s.pageAnimation}
              onChange={(val) => onChange({ pageAnimation: val as PageAnimation })}
            />
          </div>

          {/* Auto-Paging Mode */}
          <div className="space-y-2 pt-2 border-t border-[var(--stroke)]">
            <Switch
              label="Auto page turn"
              checked={s.autoPaging}
              onCheckedChange={(val) => onChange({ autoPaging: val })}
            />
            {s.autoPaging && (
              <div className="space-y-1.5 pl-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-2)]">Paging pace</span>
                  <span className="text-[var(--text-3)]">{s.autoPagingInterval}s per page</span>
                </div>
                <Slider
                  value={[s.autoPagingInterval]}
                  min={5}
                  max={60}
                  step={5}
                  onValueChange={([val]) => onChange({ autoPagingInterval: val })}
                />
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-2 border-t border-[var(--stroke)]">
            <Switch
              label="Justify text"
              checked={s.justify}
              onCheckedChange={(val) => onChange({ justify: val })}
            />
            <Switch
              label="Hyphenation"
              checked={s.hyphenate}
              onCheckedChange={(val) => onChange({ hyphenate: val })}
            />
            <Switch
              label="Auto dictionary lookup"
              checked={s.autoDefine}
              onCheckedChange={(val) => onChange({ autoDefine: val })}
            />
            <Switch
              label="Mouse wheel turns pages"
              checked={s.wheelPaging}
              onCheckedChange={(val) => onChange({ wheelPaging: val })}
            />
            {s.wheelPaging && (
              <Switch
                label="Invert wheel direction"
                checked={s.wheelInvert}
                onCheckedChange={(val) => onChange({ wheelInvert: val })}
              />
            )}
          </div>

          {/* Tap Zones */}
          <div className="space-y-2 pt-2 border-t border-[var(--stroke)]">
            <span className="font-semibold text-[11px] text-[var(--text-3)] uppercase tracking-wider">
              Tap Navigation
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'split', label: 'Left & Right' },
                { value: 'allNext', label: 'All Next' },
              ]}
              value={s.tapZones}
              onChange={(val) => onChange({ tapZones: val as 'split' | 'allNext' })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Note editor ---------- */

export function NoteEditor({
  annotation,
  onSave,
  onClose,
}: {
  annotation: Annotation;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(annotation.note);

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => !open && onClose()}
      title={annotation.note ? 'Edit Note' : 'Add Note'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => onSave(note)}>
            Save Note
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <blockquote className="p-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border-l-2 border-[var(--accent)] text-xs text-[var(--text-2)] italic">
          “{annotation.text}”
        </blockquote>
        <textarea
          value={note}
          placeholder="Write your notes here…"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(note);
          }}
          className="w-full h-32 p-3 text-sm rounded-[var(--r-md)] bg-[var(--layer-1)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)] resize-none"
          autoFocus
        />
      </div>
    </Dialog>
  );
}