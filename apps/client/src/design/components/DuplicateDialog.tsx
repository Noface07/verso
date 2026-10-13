import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { type Book } from '../../db';
import { fmtBytes } from '../../lib/format';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface DuplicateDialogProps {
  open: boolean;
  existingBook: Book;
  newFile: File;
  onDecision: (decision: 'replace' | 'keep-both' | 'skip') => void;
}

export const DuplicateDialog: React.FC<DuplicateDialogProps> = ({
  open,
  existingBook,
  newFile,
  onDecision,
}) => {
  return (
    <Dialog
      open={open}
      onClose={() => onDecision('skip')}
      title="Duplicate Book Found"
      className="max-w-md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30 text-[var(--text-1)]">
          <AlertTriangle className="w-5 h-5 text-[var(--warning)] shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold">
              A book with this title and author already exists in your library.
            </p>
            <p className="text-[var(--text-2)]">
              &ldquo;{existingBook.title}&rdquo; by {existingBook.author}
            </p>
          </div>
        </div>

        {/* Comparison card */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--layer-2)] border border-[var(--stroke)] text-xs">
          <div className="space-y-1">
            <span className="font-semibold text-[var(--text-3)] block uppercase tracking-wider text-[10px]">
              Existing Book
            </span>
            <p className="font-medium text-[var(--text-1)]">{existingBook.format}</p>
            <p className="text-[var(--text-2)]">{fmtBytes(existingBook.file_size)}</p>
          </div>
          <div className="space-y-1 border-l border-[var(--stroke)] pl-3">
            <span className="font-semibold text-[var(--accent)] block uppercase tracking-wider text-[10px]">
              Incoming File
            </span>
            <p className="font-medium text-[var(--text-1)]">
              {newFile.name.split('.').pop()?.toUpperCase() ?? 'FILE'}
            </p>
            <p className="text-[var(--text-2)]">{fmtBytes(newFile.size)}</p>
          </div>
        </div>

        <p className="text-xs text-[var(--text-2)]">
          Would you like to replace the existing book file (keeping existing reading position and notes), or keep both copies side by side?
        </p>

        {/* Decisions */}
        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 border-t border-[var(--stroke)]">
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => onDecision('skip')}
            className="text-xs"
          >
            Skip file
          </Button>
          <Button
            type="button"
            variant="standard"
            size="sm"
            onClick={() => onDecision('keep-both')}
            className="text-xs"
          >
            Keep both
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => onDecision('replace')}
            className="text-xs"
          >
            Replace existing
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
