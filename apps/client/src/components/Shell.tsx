import { useRef, useState, type DragEvent } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { NavRail } from '../design/components/NavRail';
import { BottomNav } from '../design/components/BottomNav';
import { AmbientBackdrop } from '../design/components/AmbientBackdrop';
import { SettingsDialog } from '../design/components/SettingsDialog';
import { ShortcutsDialog } from '../design/components/ShortcutsDialog';
import { InfoBar } from '../design/components/InfoBar';
import { useTheme } from '../design/theme';
import { OnboardingModal } from './OnboardingModal';
import { ACCEPT, importFiles } from '../lib/importBook';
import { useGlobalHotkeys } from '../lib/useHotkeys';

export interface ShellContext {
  openImport: () => void;
  importing: boolean;
  openSettings: (tab?: 'appearance' | 'account') => void;
}

export default function Shell() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'account'>('appearance');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    return typeof window !== 'undefined' && !localStorage.getItem('folio_onboarded');
  });
  const [toast, setToast] = useState<{ id: number; message: string; severity?: 'info' | 'success' | 'warning' | 'error' } | null>(null);

  const { activeCoverUrl, settings } = useTheme();

  const openImport = () => inputRef.current?.click();
  const openSettings = (tab: 'appearance' | 'account' = 'appearance') => {
    navigate('/settings');
    setSettingsTab(tab);
  };

  useGlobalHotkeys({
    onSearch: () => {
      const input = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"], input[type="text"][placeholder*="search"]');
      if (input) {
        input.focus();
        input.select();
      } else {
        navigate('/library');
      }
    },
    onImport: openImport,
    onSettings: () => openSettings('appearance'),
    onNavigate: (path) => navigate(path),
    onHelp: () => setShortcutsOpen((o) => !o),
    onEscape: () => {
      if (shortcutsOpen) setShortcutsOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
    },
  });

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setImporting(true);
    try {
      const r = await importFiles(files);
      const parts: string[] = [];
      if (r.added) parts.push(`${r.added} added`);
      if (r.skipped) parts.push(`${r.skipped} already in library`);
      if (r.failed.length) parts.push(`${r.failed.length} failed to open`);
      setToast({
        id: Date.now(),
        message: parts.join(' · ') || 'Nothing imported',
        severity: r.failed.length ? 'warning' : 'success',
      });
    } finally {
      setImporting(false);
    }
  }

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void handleFiles([...e.dataTransfer.files]);
  };

  return (
    <div
      className="relative flex h-screen w-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-1)] select-none"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* Ambient backdrop layer */}
      <AmbientBackdrop coverUrl={activeCoverUrl} enabled={settings.ambientEnabled} />

      {/* Desktop/Tablet Navigation Rail */}
      <NavRail onOpenSettings={() => openSettings('appearance')} />

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex flex-col h-full overflow-hidden pb-[56px] md:pb-0">
        <Outlet context={{ openImport, importing, openSettings } satisfies ShellContext} />
      </main>

      {/* Mobile Bottom Navigation Bar (< 600px) */}
      <BottomNav onOpenSettings={() => openSettings('appearance')} />

      {/* Global Hidden File Input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          void handleFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      {/* Drag & Drop Overlay */}
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none animate-in fade-in-0 duration-150">
          <div className="p-8 rounded-[var(--r-xl)] bg-[var(--layer-solid)] border-2 border-dashed border-[var(--accent)] text-center shadow-[var(--shadow-flyout)]">
            <h3 className="text-xl font-bold text-[var(--text-1)]">Drop books to import</h3>
            <p className="text-sm text-[var(--text-2)] mt-1">EPUB, MOBI, AZW3, FB2, CBZ, PDF</p>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-16 md:bottom-6 right-6 z-50 max-w-sm">
          <InfoBar
            severity={toast.severity || 'info'}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </div>
      )}

      {/* Global Settings Modal */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
      />

      {/* Keyboard Shortcuts Help Modal */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* First-launch Onboarding Modal */}
      <OnboardingModal
        open={onboardingOpen}
        onComplete={() => {
          localStorage.setItem('folio_onboarded', 'true');
          setOnboardingOpen(false);
        }}
        onNavigateStore={() => navigate('/store')}
        onOpenSignIn={() => navigate('/settings')}
      />
    </div>
  );
}