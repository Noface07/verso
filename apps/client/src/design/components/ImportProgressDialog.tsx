import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface FileImportStatus {
  name: string;
  size: number;
  status: 'pending' | 'processing' | 'done' | 'skipped' | 'error';
  error?: string;
}

export interface ImportProgressDialogProps {
  open: boolean;
  files: FileImportStatus[];
  onCancel: () => void;
  onClose: () => void;
  isComplete: boolean;
}

export const ImportProgressDialog: React.FC<ImportProgressDialogProps> = ({
  open,
  files,
  onCancel,
  onClose,
  isComplete,
}) => {
  const completedCount = files.filter(
    (f) => f.status === 'done' || f.status === 'skipped' || f.status === 'error',
  ).length;
  const pct = files.length > 0 ? Math.round((completedCount / files.length) * 100) : 0;

  return (
    <Dialog
      open={open}
      onClose={isComplete ? onClose : onCancel}
      title={isComplete ? 'Import complete' : 'Importing books…'}
      className="max-w-lg"
    >
      <div className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-[var(--text-2)] font-medium">
            <span>
              {completedCount} of {files.length} processed
            </span>
            <span className="text-[var(--accent)] font-semibold">{pct}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--layer-2)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all duration-[var(--d-fast)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Per-file list */}
        <div className="max-h-60 overflow-y-auto space-y-1.5 p-1 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-xs">
          {files.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="flex items-center justify-between p-2 rounded hover:bg-[var(--layer-3)] transition-colors gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                {file.status === 'pending' && (
                  <Clock className="w-3.5 h-3.5 text-[var(--text-3)] shrink-0" />
                )}
                {file.status === 'processing' && (
                  <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin shrink-0" />
                )}
                {file.status === 'done' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)] shrink-0" />
                )}
                {file.status === 'skipped' && (
                  <AlertCircle className="w-3.5 h-3.5 text-[var(--warning)] shrink-0" />
                )}
                {file.status === 'error' && (
                  <XCircle className="w-3.5 h-3.5 text-[var(--danger)] shrink-0" />
                )}
                <span className="truncate text-[var(--text-1)] font-medium">
                  {file.name}
                </span>
              </div>

              <div className="shrink-0 text-[11px]">
                {file.status === 'pending' && (
                  <span className="text-[var(--text-3)]">Queued</span>
                )}
                {file.status === 'processing' && (
                  <span className="text-[var(--accent)]">Processing</span>
                )}
                {file.status === 'done' && (
                  <span className="text-[var(--success)] font-medium">Added</span>
                )}
                {file.status === 'skipped' && (
                  <span className="text-[var(--text-3)]">Skipped</span>
                )}
                {file.status === 'error' && (
                  <span className="text-[var(--danger)]" title={file.error}>
                    Failed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Dialog Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--stroke)]">
          {!isComplete ? (
            <Button variant="subtle" size="sm" onClick={onCancel}>
              Cancel remaining
            </Button>
          ) : (
            <Button variant="accent" size="sm" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
