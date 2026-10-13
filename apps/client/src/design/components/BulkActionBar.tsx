import React from 'react';
import {
  FolderPlus,
  Heart,
  CheckCircle,
  Download,
  Trash2,
  X,
  CheckSquare,
  Loader2,
} from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';

export interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  isAllSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onAddToCollection: () => void;
  onToggleFavorite: () => void;
  onToggleFinished: () => void;
  onExport: () => void;
  onDelete: () => void;
  exporting?: boolean;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  totalCount,
  isAllSelected,
  onSelectAll,
  onClearSelection,
  onAddToCollection,
  onToggleFavorite,
  onToggleFinished,
  onExport,
  onDelete,
  exporting = false,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[92vw] w-auto animate-in fade-in slide-in-from-bottom-4 duration-[var(--d-normal)]"
    >
      <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl bg-[var(--layer-solid)] border border-[var(--stroke-strong)] shadow-[var(--shadow-flyout)] text-[var(--text-1)] select-none">
        {/* Count & Select All */}
        <div className="flex items-center gap-2 pr-2 border-r border-[var(--stroke)]">
          <button
            type="button"
            onClick={isAllSelected ? onClearSelection : onSelectAll}
            className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md hover:bg-[var(--layer-3)] transition-colors cursor-pointer text-[var(--accent)]"
            title={isAllSelected ? 'Deselect all' : 'Select all'}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>
              {selectedCount} <span className="hidden sm:inline">of {totalCount}</span>
            </span>
          </button>
        </div>

        {/* Collection */}
        <Button
          variant="subtle"
          size="sm"
          onClick={onAddToCollection}
          title="Add to collection"
          className="gap-1.5 text-xs px-2 sm:px-2.5 h-8"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[var(--text-2)]" />
          <span className="hidden md:inline">Collection</span>
        </Button>

        {/* Favorite */}
        <Button
          variant="subtle"
          size="sm"
          onClick={onToggleFavorite}
          title="Toggle favourite"
          className="gap-1.5 text-xs px-2 sm:px-2.5 h-8"
        >
          <Heart className="w-3.5 h-3.5 text-[var(--text-2)]" />
          <span className="hidden md:inline">Favourite</span>
        </Button>

        {/* Mark Finished */}
        <Button
          variant="subtle"
          size="sm"
          onClick={onToggleFinished}
          title="Mark finished / unread"
          className="gap-1.5 text-xs px-2 sm:px-2.5 h-8"
        >
          <CheckCircle className="w-3.5 h-3.5 text-[var(--text-2)]" />
          <span className="hidden md:inline">Finished</span>
        </Button>

        {/* Export ZIP */}
        <Button
          variant="subtle"
          size="sm"
          onClick={onExport}
          disabled={exporting}
          title="Export books as ZIP"
          className="gap-1.5 text-xs px-2 sm:px-2.5 h-8"
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
          ) : (
            <Download className="w-3.5 h-3.5 text-[var(--text-2)]" />
          )}
          <span className="hidden md:inline">Export</span>
        </Button>

        {/* Delete */}
        <Button
          variant="subtle"
          size="sm"
          onClick={onDelete}
          title="Remove selected books"
          className="gap-1.5 text-xs px-2 sm:px-2.5 h-8 text-[var(--danger)] hover:bg-[var(--danger)]/10"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Remove</span>
        </Button>

        {/* Dismiss / Clear */}
        <div className="pl-1 border-l border-[var(--stroke)]">
          <IconButton
            label="Clear selection"
            icon={<X className="w-4 h-4" />}
            size="sm"
            variant="subtle"
            onClick={onClearSelection}
            title="Clear selection"
          />
        </div>
      </div>
    </div>
  );
};
