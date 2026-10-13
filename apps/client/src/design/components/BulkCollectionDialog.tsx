import React, { useState } from 'react';
import { FolderPlus, Check } from 'lucide-react';
import { type Collection } from '../../db';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface BulkCollectionDialogProps {
  open: boolean;
  collections: Collection[];
  selectedCount: number;
  onClose: () => void;
  onAssign: (collectionId: string) => void;
  onCreateNewCollection: (name: string) => void;
}

export const BulkCollectionDialog: React.FC<BulkCollectionDialogProps> = ({
  open,
  collections,
  selectedCount,
  onClose,
  onAssign,
  onCreateNewCollection,
}) => {
  const [newColName, setNewColName] = useState('');
  const [selectedColId, setSelectedColId] = useState<string>(collections[0]?.id || '');

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to collection"
      className="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-xs text-[var(--text-2)]">
          Add {selectedCount} selected {selectedCount === 1 ? 'book' : 'books'} to a collection:
        </p>

        {/* Existing collections list */}
        <div className="space-y-1.5 max-h-48 overflow-y-auto p-1 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)]">
          {collections.length === 0 ? (
            <p className="text-xs text-[var(--text-3)] p-3 text-center">
              No collections yet. Create one below.
            </p>
          ) : (
            collections.map((col) => {
              const isSelected = selectedColId === col.id;
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => setSelectedColId(col.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                    isSelected
                      ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-semibold'
                      : 'hover:bg-[var(--layer-3)] text-[var(--text-1)]'
                  }`}
                >
                  <span>{col.name}</span>
                  {isSelected && <Check className="w-4 h-4 stroke-[2.5]" />}
                </button>
              );
            })
          )}
        </div>

        {/* Create new collection inline */}
        <div className="pt-2 border-t border-[var(--stroke)]">
          <span className="block text-[11px] font-medium text-[var(--text-3)] mb-1">
            Or create a new collection:
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="New collection name…"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newColName.trim()) {
                  onCreateNewCollection(newColName.trim());
                  setNewColName('');
                }
              }}
              className="flex-1 text-xs px-2.5 py-1.5 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
            <Button
              type="button"
              variant="standard"
              size="sm"
              disabled={!newColName.trim()}
              onClick={() => {
                if (newColName.trim()) {
                  onCreateNewCollection(newColName.trim());
                  setNewColName('');
                }
              }}
              className="gap-1 text-xs"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Create
            </Button>
          </div>
        </div>

        {/* Modal actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--stroke)]">
          <Button variant="subtle" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!selectedColId}
            onClick={() => {
              if (selectedColId) {
                onAssign(selectedColId);
                onClose();
              }
            }}
          >
            Add books
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
