import React, { useState, useRef } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react';
import { IconButton } from '../design/components/IconButton';

export interface ImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageViewer({ src, alt, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const zoomIn = () => setScale((s) => Math.min(4, s + 0.25));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.25));
  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md select-none touch-none animate-fade-in"
    >
      {/* Top Controls Toolbar */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10 p-1.5 rounded-full bg-[var(--layer-solid)]/80 border border-[var(--stroke)] shadow-lg">
        <IconButton
          icon={<ZoomIn className="w-5 h-5 text-[var(--text-1)]" />}
          label="Zoom in"
          onClick={zoomIn}
        />
        <IconButton
          icon={<ZoomOut className="w-5 h-5 text-[var(--text-1)]" />}
          label="Zoom out"
          onClick={zoomOut}
        />
        <IconButton
          icon={<RotateCcw className="w-5 h-5 text-[var(--text-1)]" />}
          label="Reset zoom"
          onClick={resetZoom}
        />
        <div className="w-[1px] h-5 bg-[var(--stroke)] mx-0.5" />
        <IconButton
          icon={<X className="w-5 h-5 text-[var(--text-1)]" />}
          label="Close viewer"
          onClick={onClose}
        />
      </div>

      {/* Main Draggable/Zoomable Image Area */}
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing p-4"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={src}
          alt={alt || 'Full screen preview'}
          className="max-w-[90vw] max-h-[85vh] object-contain transition-transform duration-75 select-none pointer-events-none rounded-[var(--r-md)] shadow-2xl"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
          draggable={false}
        />
      </div>

      {/* Bottom Zoom Indicator */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[var(--layer-solid)]/80 border border-[var(--stroke)] text-xs font-semibold text-[var(--text-2)]">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
