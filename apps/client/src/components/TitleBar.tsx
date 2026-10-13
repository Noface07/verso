import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, BookOpen } from 'lucide-react';
import {
  isTauri,
  minimizeWindow,
  toggleMaximizeWindow,
  isWindowMaximized,
  closeWindow,
  toggleTauriFullscreen,
} from '../lib/tauri';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const runningInTauri = isTauri();

  useEffect(() => {
    if (!runningInTauri) return;

    let active = true;
    const checkState = async () => {
      const isMax = await isWindowMaximized();
      if (active) setMaximized(isMax);
    };

    void checkState();
    const interval = setInterval(checkState, 500);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        void toggleTauriFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('keydown', onKey);
    };
  }, [runningInTauri]);

  if (!runningInTauri) return null;

  return (
    <div
      data-tauri-drag-region
      className="h-8 w-full flex items-center justify-between select-none bg-[var(--layer-solid)]/90 backdrop-blur-md border-b border-[var(--stroke)] text-[var(--text-1)] text-xs z-50 shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: App Logo & Title */}
      <div className="flex items-center gap-2 px-3 pointer-events-none">
        <BookOpen className="w-3.5 h-3.5 text-[var(--accent)]" />
        <span className="font-semibold text-xs tracking-tight">Folio</span>
      </div>

      {/* Middle: Drag area spacer */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Right: Window Control Buttons */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => void minimizeWindow()}
          className="h-full w-11 flex items-center justify-center hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer border-none p-0 outline-none"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => {
            void toggleMaximizeWindow();
            setMaximized(!maximized);
          }}
          className="h-full w-11 flex items-center justify-center hover:bg-[var(--layer-2)] active:bg-[var(--layer-3)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer border-none p-0 outline-none"
        >
          {maximized ? (
            <Copy className="w-3 h-3 rotate-180" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        <button
          type="button"
          aria-label="Close"
          onClick={() => void closeWindow()}
          className="h-full w-11 flex items-center justify-center hover:bg-[var(--danger)] hover:text-[var(--on-accent)] active:opacity-90 text-[var(--text-2)] transition-colors cursor-pointer border-none p-0 outline-none"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
