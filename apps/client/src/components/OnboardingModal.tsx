import React, { useState } from 'react';
import { BookOpen, Sparkles, Cloud, ArrowRight, Check, Upload, ShoppingBag } from 'lucide-react';
import { useTheme, ACCENT_PRESETS } from '../design/theme';
import { Button } from '../design/components/Button';
import { importOne } from '../lib/importBook';
import { t } from '../lib/i18n';

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  onNavigateStore?: () => void;
  onOpenSignIn?: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  open,
  onComplete,
  onNavigateStore,
  onOpenSignIn,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const { settings, updateSettings } = useTheme();
  const [importedCount, setImportedCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  if (!open) return null;

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    let count = 0;
    for (const file of files) {
      const added = await importOne(file);
      if (added) count++;
    }
    setImportedCount((prev) => prev + count);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    let count = 0;
    for (const file of files) {
      const added = await importOne(file);
      if (added) count++;
    }
    setImportedCount((prev) => prev + count);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome Onboarding"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in-0 duration-200"
    >
      <div className="w-full max-w-lg rounded-[var(--r-xl)] bg-[var(--surface-base)] border border-[var(--border-subtle)] shadow-2xl p-6 sm:p-8 flex flex-col gap-6 text-[var(--text-primary)]">
        {/* Step indicator */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-white text-xs font-bold shadow-sm">
              {step}
            </div>
            <span className="text-xs uppercase tracking-wider font-semibold text-[var(--text-muted)]">
              Step {step} of 3
            </span>
          </div>

          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 w-6 rounded-full transition-all ${
                  s === step
                    ? 'bg-[var(--accent)]'
                    : s < step
                      ? 'bg-[var(--accent-muted)]'
                      : 'bg-[var(--surface-subtle)]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step 1: Welcome & Theme */}
        {step === 1 && (
          <div className="flex flex-col gap-6 animate-in fade-in-50 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent)]">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {t('onboarding.welcomeTitle')}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {t('onboarding.welcomeSubtitle')}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                {t('settings.theme')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['system', 'light', 'dark'] as const).map((tMode) => (
                  <button
                    key={tMode}
                    type="button"
                    onClick={() => updateSettings({ theme: tMode })}
                    className={`py-2 px-3 rounded-[var(--r-md)] border text-sm font-medium capitalize transition-all cursor-pointer ${
                      settings.theme === tMode
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold shadow-sm'
                        : 'border-[var(--border-subtle)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {tMode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                {t('settings.accentColor')}
              </label>
              <div className="flex flex-wrap gap-2.5">
                {Object.entries(ACCENT_PRESETS).map(([id, color]) => (
                  <button
                    key={id}
                    type="button"
                    title={id}
                    onClick={() => updateSettings({ accent: id })}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 cursor-pointer shadow-sm ${
                      settings.accent === id ? 'ring-2 ring-offset-2 ring-[var(--accent)] scale-105' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {settings.accent === id && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="accent" onClick={() => setStep(2)}>
                {t('onboarding.next')} <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Add Books */}
        {step === 2 && (
          <div className="flex flex-col gap-6 animate-in fade-in-50 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent)]">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {t('onboarding.addBooksTitle')}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {t('onboarding.addBooksSubtitle')}
                </p>
              </div>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-[var(--r-lg)] p-8 transition-colors text-center cursor-pointer ${
                isDragging
                  ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Upload className="w-8 h-8 text-[var(--text-muted)] mb-2" />
              <p className="text-sm font-semibold">{t('onboarding.dropBooksHere')}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 mb-3">
                Supports EPUB, MOBI, AZW3, FB2, CBZ, CBR, PDF
              </p>

              <label className="cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept=".epub,.mobi,.azw3,.azw,.fb2,.cbz,.cbr,.cb7,.pdf"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <span className="text-xs font-semibold px-3 py-1.5 rounded-[var(--r-md)] bg-[var(--surface-subtle)] hover:bg-[var(--surface-overlay)] text-[var(--accent)] border border-[var(--border-subtle)] transition-colors">
                  {t('onboarding.browseFiles')}
                </span>
              </label>

              {importedCount > 0 && (
                <div className="mt-4 flex items-center gap-1.5 text-xs text-[var(--accent)] font-semibold">
                  <Check className="w-4 h-4" /> {importedCount} book{importedCount > 1 ? 's' : ''} added to your library!
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="standard"
                onClick={() => {
                  onNavigateStore?.();
                  setStep(3);
                }}
              >
                <ShoppingBag className="w-4 h-4 mr-1.5" /> {t('onboarding.exploreStore')}
              </Button>
              <Button variant="accent" onClick={() => setStep(3)}>
                {t('onboarding.next')} <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Sync & Finish */}
        {step === 3 && (
          <div className="flex flex-col gap-6 animate-in fade-in-50 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent)]">
                <Cloud className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {t('onboarding.syncTitle')}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {t('onboarding.syncSubtitle')}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 p-4 rounded-[var(--r-lg)] bg-[var(--surface-subtle)] border border-[var(--border-subtle)]">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold">Self-hosted or Cloud Sync</h4>
                  <p className="text-xs text-[var(--text-muted)]">
                    Progress, highlights, bookmarks, and statistics stay in sync.
                  </p>
                </div>
                <Button
                  variant="standard"
                  size="sm"
                  onClick={() => {
                    onOpenSignIn?.();
                    onComplete();
                  }}
                >
                  {t('onboarding.signInNow')}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="accent" onClick={onComplete}>
                {t('onboarding.startReading')} <Check className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
