import React, { useState } from 'react';
import {
  Palette,
  BookOpen,
  Layers,
  Library as LibraryIcon,
  User,
  HardDrive,
  Archive,
  Info,
  Check,
  Download,
  Upload,
  Trash2,
} from 'lucide-react';
import { useTheme, ACCENT_PRESETS } from '../design/theme';
import { useReaderSettings } from '../lib/readerSettings';
import { db } from '../db';
import { Button } from '../design/components/Button';
import { Dialog } from '../design/components/Dialog';
import { exportBackup, importBackup, downloadBackupBlob } from '../lib/backup';
import { t, setAppLanguage } from '../lib/i18n';
import { isCrashReportingEnabled, setCrashReportingEnabled } from '../lib/crashReporter';
import { useLiveQuery } from 'dexie-react-hooks';
import { AccountSettings } from '../features/auth/AccountSettings';
import { getContentRatings, setContentRating, type ContentRating } from '../lib/mangaPrefs';
import { isAndroidDevice } from '../lib/tauri';

type SettingsTab =
  | 'appearance'
  | 'reading'
  | 'manga'
  | 'library'
  | 'account'
  | 'storage'
  | 'backup'
  | 'about';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const { settings, updateSettings } = useTheme();
  const [readerSettings, updateReaderSettings] = useReaderSettings();

  // Storage metrics
  const books = useLiveQuery(() => db.books.toArray(), []) || [];
  const mangaPagesCount = useLiveQuery(() => db.manga_pages.count(), []) || 0;
  const coversCount = useLiveQuery(() => db.covers.count(), []) || 0;

  const totalBookBytes = books.reduce((acc, b) => acc + (b.file_size || 0), 0);
  const totalBookMB = (totalBookBytes / (1024 * 1024)).toFixed(1);

  // Backup state
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Adult rating confirmation
  const [adultConfirmOpen, setAdultConfirmOpen] = useState(false);
  const [pendingAdultKey, setPendingAdultKey] = useState<'erotica' | 'pornographic' | null>(null);
  // Previously the opt-in only showed a toast; nothing was stored or sent to MangaDex.
  const [ratings, setRatings] = useState<ContentRating[]>(() => getContentRatings());
  const toggleRating = (rating: ContentRating, enabled: boolean) => setRatings(setContentRating(rating, enabled));

  // Crash reporting opt-in
  const [crashReporting, setCrashReporting] = useState(isCrashReportingEnabled());

  // Cache cleared toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExportBackup = async () => {
    setExporting(true);
    try {
      const blob = await exportBackup();
      downloadBackupBlob(blob);
      showToast(t('backup.exportSuccess'));
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const res = await importBackup(file);
      showToast(
        `${t('backup.importSuccess')} (${res.importedBooks} books, ${res.importedAnnotations} annotations)`,
      );
    } catch (err) {
      console.error('Import failed:', err);
      showToast(t('backup.importError'));
    } finally {
      setImporting(false);
    }
  };

  const clearMangaCache = async () => {
    await db.manga_pages.clear();
    showToast('Manga offline page cache cleared');
  };

  const navItems: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: t('settings.appearance'), icon: <Palette className="w-4 h-4" /> },
    { id: 'reading', label: t('settings.reading'), icon: <BookOpen className="w-4 h-4" /> },
    { id: 'manga', label: t('settings.manga'), icon: <Layers className="w-4 h-4" /> },
    { id: 'library', label: t('settings.library'), icon: <LibraryIcon className="w-4 h-4" /> },
    { id: 'account', label: t('settings.account'), icon: <User className="w-4 h-4" /> },
    { id: 'storage', label: t('settings.storage'), icon: <HardDrive className="w-4 h-4" /> },
    { id: 'backup', label: t('settings.backup'), icon: <Archive className="w-4 h-4" /> },
    { id: 'about', label: t('settings.about'), icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <div className="w-full h-full flex flex-col md:flex-row overflow-hidden bg-[var(--surface-base)] text-[var(--text-primary)]">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2.5 rounded-[var(--r-md)] bg-[var(--surface-overlay)] border border-[var(--border-subtle)] text-[var(--accent)] font-semibold shadow-lg animate-in fade-in-0 duration-200">
          {toastMessage}
        </div>
      )}

      {/* Side Navigation Rail */}
      <div className="w-full md:w-60 border-b md:border-b-0 md:border-r border-[var(--border-subtle)] p-4 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto shrink-0 bg-[var(--surface-subtle)]">
        <h1 className="hidden md:block text-lg font-bold px-3 py-2 text-[var(--text-primary)]">
          {t('settings.title')}
        </h1>

        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-[var(--r-md)] text-sm font-medium transition-all shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              activeTab === item.id
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-10 max-w-3xl">
        {/* Appearance Tab */}
        {activeTab === 'appearance' && (
          <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">{t('settings.appearance')}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Customize colors, backdrop, and visual density.
              </p>
            </div>

            {/* Theme */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold">{t('settings.theme')}</label>
              <div className="grid grid-cols-3 gap-3">
                {(['system', 'light', 'dark'] as const).map((tMode) => (
                  <button
                    key={tMode}
                    type="button"
                    onClick={() => updateSettings({ theme: tMode })}
                    className={`p-3 rounded-[var(--r-md)] border text-sm font-medium capitalize text-center transition-all cursor-pointer ${
                      settings.theme === tMode
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold'
                        : 'border-[var(--border-subtle)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {tMode}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Palette */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold">{t('settings.accentColor')}</label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  title="Dynamic"
                  onClick={() => updateSettings({ accent: 'dynamic' })}
                  className={`px-3 py-1.5 rounded-[var(--r-md)] border text-xs font-semibold cursor-pointer transition-all ${
                    settings.accent === 'dynamic'
                      ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  Dynamic
                </button>
                {Object.entries(ACCENT_PRESETS).map(([id, color]) => (
                  <button
                    key={id}
                    type="button"
                    title={id}
                    onClick={() => updateSettings({ accent: id })}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 cursor-pointer shadow-sm ${
                      settings.accent === id ? 'ring-2 ring-offset-2 ring-[var(--accent)] scale-105' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {settings.accent === id && <Check className="w-5 h-5 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Ambient Cover Backdrop */}
            <div className="flex items-center justify-between p-4 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h4 className="text-sm font-semibold">{t('settings.ambientBackdrop')}</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Glow subtle book cover colors in backgrounds and navigation.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.ambientEnabled}
                onChange={(e) => updateSettings({ ambientEnabled: e.target.checked })}
                className="w-5 h-5 rounded cursor-pointer accent-[var(--accent)]"
              />
            </div>

            {/* App Language */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold">{t('settings.language')}</label>
              <select
                onChange={(e) => void setAppLanguage(e.target.value)}
                defaultValue="en"
                className="w-full max-w-xs p-2.5 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)] text-sm"
              >
                <option value="en">English (LTR)</option>
                <option value="ar">العربية (Arabic - RTL)</option>
              </select>
            </div>
          </div>
        )}

        {/* Reading Tab */}
        {activeTab === 'reading' && (
          <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">{t('settings.reading')}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Default layout, typography, controls, and accessibility options.
              </p>
            </div>

            {/* Keep Screen Awake */}
            <div className="flex items-center justify-between p-4 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h4 className="text-sm font-semibold">{t('settings.keepScreenOn')}</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Prevents the device display from sleeping during reading sessions.
                </p>
              </div>
              <input
                type="checkbox"
                checked={readerSettings.keepScreenOn ?? true}
                onChange={(e) => updateReaderSettings({ keepScreenOn: e.target.checked })}
                className="w-5 h-5 rounded cursor-pointer accent-[var(--accent)]"
              />
            </div>

            {/* Volume Key Navigation (phones only: desktops have no volume rocker) */}
            {isAndroidDevice() && (
            <div className="flex items-center justify-between p-4 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h4 className="text-sm font-semibold">{t('settings.volumeKeys')}</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Use hardware Volume Up / Down buttons to turn pages.
                </p>
              </div>
              <input
                type="checkbox"
                checked={readerSettings.volumeKeysTurn ?? false}
                onChange={(e) => updateReaderSettings({ volumeKeysTurn: e.target.checked })}
                className="w-5 h-5 rounded cursor-pointer accent-[var(--accent)]"
              />
            </div>
            )}

            {/* Haptic Feedback */}
            <div className="flex items-center justify-between p-4 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h4 className="text-sm font-semibold">{t('settings.haptics')}</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Subtle vibration feedback on page turns and tap zones.
                </p>
              </div>
              <input
                type="checkbox"
                checked={readerSettings.haptics ?? true}
                onChange={(e) => updateReaderSettings({ haptics: e.target.checked })}
                className="w-5 h-5 rounded cursor-pointer accent-[var(--accent)]"
              />
            </div>
          </div>
        )}

        {/* Library Tab */}
        {activeTab === 'library' && <LibraryPrefs />}

        {/* Account & Sync Tab (the tab existed but nothing was rendered for it) */}
        {activeTab === 'account' && (
          <div className="flex flex-col gap-6 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">{t('settings.account')}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Sign in to sync your library, progress and highlights across devices.
              </p>
            </div>
            <AccountSettings />
          </div>
        )}

        {/* Manga Tab */}
        {activeTab === 'manga' && (
          <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">{t('settings.manga')}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                MangaDex settings, content filtering, and reading modes.
              </p>
            </div>

            {/* Content Ratings */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold">{t('settings.contentRating')}</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center justify-between p-3 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                  <span className="text-sm">{t('settings.safe')}</span>
                  <input type="checkbox" defaultChecked disabled className="w-4 h-4 accent-[var(--accent)]" />
                </div>
                <div className="flex items-center justify-between p-3 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                  <span className="text-sm">{t('settings.suggestive')}</span>
                  <input
                    type="checkbox"
                    aria-label={t('settings.suggestive')}
                    checked={ratings.includes('suggestive')}
                    onChange={(e) => toggleRating('suggestive', e.target.checked)}
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                  <span className="text-sm text-[var(--warning)] font-medium">{t('settings.erotica')}</span>
                  {ratings.includes('erotica') ? (
                    <button
                      type="button"
                      onClick={() => toggleRating('erotica', false)}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)] cursor-pointer"
                    >
                      On · Turn off
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingAdultKey('erotica');
                        setAdultConfirmOpen(true);
                      }}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded bg-[var(--surface-overlay)] border border-[var(--border-subtle)] hover:bg-[var(--surface-base)] cursor-pointer"
                    >
                      Opt-in (18+)
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between p-3 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                  <span className="text-sm text-[var(--danger)] font-medium">{t('settings.pornographic')}</span>
                  {ratings.includes('pornographic') ? (
                    <button
                      type="button"
                      onClick={() => toggleRating('pornographic', false)}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)] cursor-pointer"
                    >
                      On · Turn off
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingAdultKey('pornographic');
                        setAdultConfirmOpen(true);
                      }}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded bg-[var(--surface-overlay)] border border-[var(--border-subtle)] hover:bg-[var(--surface-base)] cursor-pointer"
                    >
                      Opt-in (18+)
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Clear Manga Cache */}
            <div className="flex items-center justify-between gap-4 p-4 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold">{t('settings.clearMangaCache')}</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  {mangaPagesCount} pages cached offline.
                </p>
              </div>
              <Button
                variant="standard"
                size="sm"
                className="shrink-0"
                icon={<Trash2 className="w-4 h-4 text-[var(--danger)]" />}
                onClick={clearMangaCache}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Storage Tab */}
        {activeTab === 'storage' && (
          <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">{t('settings.storage')}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Local disk usage and cache management.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">
                  {t('settings.booksStorage')}
                </span>
                <h3 className="text-2xl font-bold mt-1 text-[var(--accent)]">{totalBookMB} MB</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">{books.length} items</p>
              </div>
              <div className="p-4 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">
                  {t('settings.coversStorage')}
                </span>
                <h3 className="text-2xl font-bold mt-1">{coversCount} covers</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">IndexedDB / FS</p>
              </div>
              <div className="p-4 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
                <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">
                  {t('settings.mangaStorage')}
                </span>
                <h3 className="text-2xl font-bold mt-1">{mangaPagesCount} pages</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">Offline cache</p>
              </div>
            </div>
          </div>
        )}

        {/* Backup Tab */}
        {activeTab === 'backup' && (
          <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">{t('settings.backup')}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Create full offline archives of your books, progress, highlights, and settings.
              </p>
            </div>

            <div className="flex flex-col gap-4 p-5 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h3 className="text-base font-semibold">{t('settings.exportBackup')}</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Produces a standalone `.foliobackup` archive containing all tables and book files.
                </p>
              </div>
              <div>
                <Button variant="accent" onClick={handleExportBackup} disabled={exporting}>
                  <Download className="w-4 h-4 mr-1.5" />
                  {exporting ? 'Exporting…' : 'Export Full Backup'}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-4 p-5 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h3 className="text-base font-semibold">{t('settings.restoreBackup')}</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Merge a `.foliobackup` archive into Folio using Last-Write-Wins rules.
                </p>
              </div>
              <div>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".foliobackup,.zip"
                    onChange={handleImportBackup}
                    disabled={importing}
                    className="hidden"
                  />
                  <span className="inline-flex items-center text-sm font-semibold px-4 py-2 rounded-[var(--r-md)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-base)] border border-[var(--border-subtle)] text-[var(--accent)] transition-colors">
                    <Upload className="w-4 h-4 mr-1.5" />
                    {importing ? 'Restoring…' : 'Select .foliobackup File'}
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* About Tab */}
        {activeTab === 'about' && (
          <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
            <div>
              <h2 className="text-xl font-bold">Folio</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Version 0.1.0 · Designed for distraction-free reading.
              </p>
            </div>

            <div className="flex flex-col gap-3 p-4 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] leading-relaxed">
              <h4 className="font-semibold text-sm text-[var(--text-primary)]">
                {t('settings.licenses')}
              </h4>
              <p>• Foliate-js — MIT License (John Factotum)</p>
              <p>• Atkinson Hyperlegible, Literata, Inter, Source Serif 4 — Open Font Licenses</p>
              <p>• MangaDex API — Powered by MangaDex.org. Follows official Acceptable Use Policy.</p>
            </div>

            {/* Privacy & Diagnostics */}
            <div className="flex items-center justify-between p-4 rounded-[var(--r-md)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div>
                <h4 className="text-sm font-semibold">Anonymous Error Reporting</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Help improve Folio by sending anonymous crash logs. Off by default; no personal data or book text is ever sent.
                </p>
              </div>
              <input
                type="checkbox"
                checked={crashReporting}
                onChange={(e) => {
                  setCrashReportingEnabled(e.target.checked);
                  setCrashReporting(e.target.checked);
                  showToast(e.target.checked ? 'Crash reporting enabled' : 'Crash reporting disabled');
                }}
                className="w-5 h-5 rounded cursor-pointer accent-[var(--accent)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* 18+ Confirmation Dialog */}
      <Dialog
        open={adultConfirmOpen}
        onOpenChange={setAdultConfirmOpen}
        title="Confirm Age (18+)"
      >
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-[var(--text-secondary)]">
            You are requesting access to adult-rated content ({pendingAdultKey}). Please confirm that
            you are at least 18 years old.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="standard" onClick={() => setAdultConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                setAdultConfirmOpen(false);
                if (pendingAdultKey) toggleRating(pendingAdultKey, true);
                showToast(`Opted into ${pendingAdultKey} ratings`);
              }}
            >
              Confirm 18+
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// Defaults the Library page reads on open (it also remembers the last choice).
const LAYOUTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
] as const;
const SORTS = [
  { value: 'recent', label: 'Recently read' },
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'progress', label: 'Progress' },
  { value: 'series', label: 'Series' },
] as const;

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function LibraryPrefs() {
  const [layout, setLayout] = useState(() => readPref('folio_lib_layout', 'grid'));
  const [sort, setSort] = useState(() => readPref('folio_lib_sort', 'recent'));
  const save = (key: string, value: string, set: (v: string) => void) => {
    set(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
  };
  const chip = (active: boolean) =>
    `px-3 py-2 rounded-[var(--r-md)] border text-sm cursor-pointer transition-colors ${
      active
        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
        : 'border-[var(--stroke)] bg-[var(--layer-2)] text-[var(--text-2)] hover:text-[var(--text-1)]'
    }`;

  return (
    <div className="flex flex-col gap-8 animate-in fade-in-50 duration-150">
      <div>
        <h2 className="text-xl font-bold">{t('settings.library')}</h2>
        <p className="text-sm text-[var(--text-muted)]">How your library is shown when you open it.</p>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Layout</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Library layout">
          {LAYOUTS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={layout === o.value}
              className={chip(layout === o.value)}
              onClick={() => save('folio_lib_layout', o.value, setLayout)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold">Sort by</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Library sort order">
          {SORTS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={sort === o.value}
              className={chip(sort === o.value)}
              onClick={() => save('folio_lib_sort', o.value, setSort)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
