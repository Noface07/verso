import React, { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { IconButton } from './IconButton';
import { Slider } from './Slider';

export interface ImageViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt?: string;
}

export const ImageViewerDialog: React.FC<ImageViewerDialogProps> = ({
  open,
  onOpenChange,
  src,
  alt = 'Image preview',
}) => {
  const [scale, setScale] = useState(1);

  const zoomIn = () => setScale((s) => Math.min(3, s + 0.25));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.25));
  const resetZoom = () => setScale(1);

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) resetZoom();
        onOpenChange(next);
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md animate-in fade-in-0 duration-150" />
        <RadixDialog.Content className="fixed inset-0 z-50 flex flex-col items-center justify-between p-4 outline-none select-none text-[var(--text-1)]">
          {/* Header Controls */}
          <div className="w-full flex items-center justify-between max-w-4xl px-2 py-1">
            <span className="text-xs font-medium text-[var(--text-2)] truncate max-w-sm">
              {alt || 'Image zoom'}
            </span>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} variant="subtle" />
            </RadixDialog.Close>
          </div>

          {/* Interactive Zoomable Viewport */}
          <div className="relative flex-1 w-full flex items-center justify-center overflow-auto p-4 cursor-grab active:cursor-grabbing">
            <img
              src={src}
              alt={alt}
              style={{
                transform: `scale(${scale})`,
                transition: 'transform 150ms cubic-bezier(0.1, 0.9, 0.2, 1)',
                maxHeight: '80vh',
                maxWidth: '90vw',
                objectFit: 'contain',
              }}
              className="rounded-[var(--r-md)] shadow-2xl pointer-events-auto"
              draggable={false}
            />
          </div>

          {/* Bottom Zoom Toolbar */}
          <div className="flex items-center gap-3 px-4 py-2 rounded-[var(--r-pill)] bg-[var(--layer-solid)] border border-[var(--stroke)] shadow-[var(--shadow-flyout)]">
            <IconButton
              label="Zoom out"
              icon={<ZoomOut className="w-4 h-4" />}
              size="sm"
              variant="subtle"
              onClick={zoomOut}
              disabled={scale <= 0.5}
            />
            <div className="w-28 flex items-center">
              <Slider
                value={[scale]}
                min={0.5}
                max={3}
                step={0.1}
                onValueChange={([val]) => setScale(val)}
              />
            </div>
            <IconButton
              label="Zoom in"
              icon={<ZoomIn className="w-4 h-4" />}
              size="sm"
              variant="subtle"
              onClick={zoomIn}
              disabled={scale >= 3}
            />
            <div className="w-[1px] h-4 bg-[var(--stroke)] mx-1" />
            <IconButton
              label="Reset zoom"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              size="sm"
              variant="subtle"
              onClick={resetZoom}
            />
            <span className="text-xs font-mono text-[var(--text-2)] min-w-[36px] text-right">
              {Math.round(scale * 100)}%
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};
