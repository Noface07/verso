import { useState, useRef, useEffect } from 'react';
import { Copy, Download, X, Check } from 'lucide-react';
import { Button } from '../design/components/Button';
import { IconButton } from '../design/components/IconButton';

export interface QuoteCardShareProps {
  quote: string;
  title: string;
  author: string;
  onClose: () => void;
}

export type CardThemeId = 'paper' | 'obsidian' | 'sepia' | 'sage';

const CARD_THEMES: Record<
  CardThemeId,
  { name: string; bg: string; text: string; subtext: string; quoteMark: string; border: string }
> = {
  paper: {
    name: 'Paper',
    bg: '#fcfbfa',
    text: '#1a1a1a',
    subtext: '#666666',
    quoteMark: '#d0c8b8',
    border: '#e8e4dc',
  },
  obsidian: {
    name: 'Obsidian',
    bg: '#141518',
    text: '#f2f2f2',
    subtext: '#8a8d93',
    quoteMark: '#2b2d33',
    border: '#2a2c33',
  },
  sepia: {
    name: 'Sepia',
    bg: '#f4ece1',
    text: '#4a3728',
    subtext: '#7d6856',
    quoteMark: '#dfd2c0',
    border: '#ded4c3',
  },
  sage: {
    name: 'Sage',
    bg: '#edf4ee',
    text: '#1f3322',
    subtext: '#526955',
    quoteMark: '#cde0cf',
    border: '#cde0cf',
  },
};

/**
 * Greedy word wrap for canvas text. Words wider than the line are broken by
 * character; with `maxLines`, the last line ends in an ellipsis if text remains.
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const fits = (s: string) => ctx.measureText(s).width <= maxWidth;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (!fits(line)) {
      let cut = line.length - 1;
      while (cut > 1 && !fits(line.slice(0, cut))) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && !fits(`${last}…`)) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

export function QuoteCardShare({ quote, title, author, onClose }: QuoteCardShareProps) {
  const [theme, setTheme] = useState<CardThemeId>('obsidian');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cleanQuote = quote.replace(/\s+/g, ' ').trim();

  // Draw card on canvas whenever theme or quote changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = CARD_THEMES[theme];
    const width = 1080;
    const height = 1350; // 4:5 aspect ratio optimal for mobile & sharing

    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, width, height);

    // Decorative border
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, width - 80, height - 80);

    // Giant quotation mark
    ctx.fillStyle = t.quoteMark;
    ctx.font = 'bold 180px Georgia, serif';
    ctx.fillText('“', 80, 200);

    const x = 100;
    const maxWidth = width - 200;

    // Footer block (divider + title + author) is measured first so the quote can
    // take whatever room is left. Long quotes shrink, then get an ellipsis, instead
    // of running off the bottom of the card; long titles wrap to two lines.
    ctx.font = '600 34px "Inter Variable", system-ui, sans-serif';
    const titleLines = wrapText(ctx, title, maxWidth, 2);
    const footerHeight = 80 + 70 + (titleLines.length - 1) * 44 + 46 + 40;
    const quoteTop = 300;
    const quoteBottom = height - 110 - footerHeight;

    let fontSize = 52;
    let quoteLines: string[] = [];
    let lineHeight = 0;
    for (; fontSize >= 24; fontSize -= 2) {
      ctx.font = `${fontSize}px Literata, Georgia, serif`;
      lineHeight = Math.round(fontSize * 1.5);
      quoteLines = wrapText(ctx, cleanQuote, maxWidth);
      if (quoteTop + (quoteLines.length - 1) * lineHeight <= quoteBottom) break;
    }
    const maxLines = Math.max(1, Math.floor((quoteBottom - quoteTop) / lineHeight) + 1);
    if (quoteLines.length > maxLines) quoteLines = wrapText(ctx, cleanQuote, maxWidth, maxLines);

    ctx.fillStyle = t.text;
    let y = quoteTop;
    quoteLines.forEach((l, i) => {
      if (i > 0) y += lineHeight;
      ctx.fillText(l, x, y);
    });

    // Divider line
    y += 80;
    ctx.strokeStyle = t.quoteMark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 120, y);
    ctx.stroke();

    // Book Title & Author
    y += 70;
    ctx.fillStyle = t.text;
    ctx.font = '600 34px "Inter Variable", system-ui, sans-serif';
    titleLines.forEach((l, i) => {
      if (i > 0) y += 44;
      ctx.fillText(l, x, y);
    });

    y += 46;
    ctx.fillStyle = t.subtext;
    ctx.font = '28px "Inter Variable", system-ui, sans-serif';
    ctx.fillText(wrapText(ctx, author, maxWidth, 1)[0] ?? '', x, y);

    // Verso watermark at bottom
    ctx.fillStyle = t.subtext;
    ctx.font = '600 22px "Inter Variable", system-ui, sans-serif';
    ctx.fillText('VERSO', width - 180, height - 90);
  }, [cleanQuote, title, author, theme]);

  const handleCopyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Clipboard write failed:', err);
      }
    }, 'image/png');
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `quote-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quote card share"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none animate-fade-in"
    >
      <div className="relative w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--r-xl)] bg-[var(--layer-solid)] border border-[var(--stroke)] shadow-2xl p-4 sm:p-6 flex flex-col gap-4 sm:gap-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--stroke)] pb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text-1)]">Share Quote Card</h3>
            <p className="text-xs text-[var(--text-3)]">
              Export high-resolution typography card for social sharing
            </p>
          </div>
          <IconButton
            icon={<X className="w-5 h-5 text-[var(--text-2)]" />}
            label="Close"
            onClick={onClose}
          />
        </div>

        {/* Theme Picker */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-2)] mr-1">Style:</span>
          {(Object.keys(CARD_THEMES) as CardThemeId[]).map((tid) => (
            <button
              key={tid}
              onClick={() => setTheme(tid)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                theme === tid
                  ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold shadow-xs'
                  : 'bg-[var(--layer-3)] text-[var(--text-2)] hover:text-[var(--text-1)] border border-[var(--stroke)]'
              }`}
            >
              {CARD_THEMES[tid].name}
            </button>
          ))}
        </div>

        {/* Canvas Preview Container */}
        <div className="w-full aspect-[4/5] max-h-[min(380px,50dvh)] flex items-center justify-center bg-[var(--layer-2)] rounded-[var(--r-lg)] border border-[var(--stroke)] p-3 overflow-hidden">
          <canvas
            ref={canvasRef}
            className="h-full w-auto max-w-full object-contain rounded-md shadow-md"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--stroke)]">
          <Button
            variant="standard"
            icon={copied ? <Check className="w-4 h-4 text-[var(--success)]" /> : <Copy className="w-4 h-4" />}
            onClick={handleCopyImage}
          >
            {copied ? 'Copied Image' : 'Copy Image'}
          </Button>
          <Button
            variant="accent"
            icon={<Download className="w-4 h-4" />}
            onClick={handleDownload}
          >
            Download PNG
          </Button>
        </div>
      </div>
    </div>
  );
}
