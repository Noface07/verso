import React from 'react';
import { Keyboard } from 'lucide-react';
import { Dialog } from './Dialog';
import { SHORTCUTS_REGISTRY } from '../../lib/useHotkeys';

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onOpenChange }) => {
  const globalShortcuts = SHORTCUTS_REGISTRY.filter((s) => s.scope === 'global');
  const readerShortcuts = SHORTCUTS_REGISTRY.filter((s) => s.scope === 'reader');

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <div className="flex items-center gap-2 text-lg font-semibold text-[var(--text-1)]">
          <Keyboard className="w-5 h-5 text-[var(--accent)]" />
          <span>Keyboard Shortcuts</span>
        </div>
      }
      description="Quick navigation and reading shortcuts across Verso."
      className="max-w-[580px]"
    >
      <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
        {/* Global Shortcuts */}
        <div>
          <h4 className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-2.5">
            Global & Navigation
          </h4>
          <div className="divide-y divide-[var(--stroke)] rounded-[var(--r-md)] border border-[var(--stroke)] bg-[var(--layer-1)]">
            {globalShortcuts.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2.5 text-xs">
                <span className="text-[var(--text-1)] font-medium">{s.label}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k, idx) => (
                    <React.Fragment key={idx}>
                      {k === 'then' ? (
                        <span className="text-[10px] text-[var(--text-3)] px-0.5">then</span>
                      ) : (
                        <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-[11px] font-mono font-medium rounded-[var(--r-sm)] bg-[var(--layer-2)] border border-[var(--stroke-strong)] text-[var(--text-1)] shadow-xs select-none">
                          {k}
                        </kbd>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reader Shortcuts */}
        <div>
          <h4 className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider mb-2.5">
            Reader Navigation & Controls
          </h4>
          <div className="divide-y divide-[var(--stroke)] rounded-[var(--r-md)] border border-[var(--stroke)] bg-[var(--layer-1)]">
            {readerShortcuts.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2.5 text-xs">
                <span className="text-[var(--text-1)] font-medium">{s.label}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k, idx) => (
                    <kbd
                      key={idx}
                      className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-[11px] font-mono font-medium rounded-[var(--r-sm)] bg-[var(--layer-2)] border border-[var(--stroke-strong)] text-[var(--text-1)] shadow-xs select-none"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
