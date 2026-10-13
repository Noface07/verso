import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AmbientBackdropProps {
  coverUrl?: string | null;
  enabled?: boolean;
  className?: string;
}

// The backdrop used to be the cover image with `filter: blur(90px)` stretched over
// the whole window. That filter is re-rasterised on every resize and whenever a
// layer above it changes, which was a major source of jank in the desktop WebView.
// Instead we draw the cover once into a tiny canvas (blurred there, where it is
// cheap) and let the GPU upscale that thumbnail: bilinear upscaling of a ~40px
// image looks like a heavy blur at essentially zero paint cost.
const THUMB_W = 36;
const THUMB_H = 54;
const cache = new Map<string, string | null>();

async function renderAmbientThumb(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.filter = 'blur(3px) saturate(1.4)';
    // Overdraw the edges so the blur doesn't pull in transparent borders.
    ctx.drawImage(img, -6, -6, THUMB_W + 12, THUMB_H + 12);
    // toDataURL throws if the image was cross-origin without CORS headers.
    const data = canvas.toDataURL('image/png');
    cache.set(url, data);
    return data;
  } catch {
    cache.set(url, null);
    return null;
  }
}

export const AmbientBackdrop: React.FC<AmbientBackdropProps> = ({
  coverUrl,
  enabled = true,
  className,
}) => {
  const [thumb, setThumb] = useState<{ src: string; data: string | null } | null>(null);

  useEffect(() => {
    if (!enabled || !coverUrl) return;
    let alive = true;
    void renderAmbientThumb(coverUrl).then((data) => {
      if (alive) setThumb({ src: coverUrl, data });
    });
    return () => {
      alive = false;
    };
  }, [coverUrl, enabled]);

  if (!enabled) return null;

  const ready = coverUrl && thumb?.src === coverUrl ? thumb : null;

  return (
    <div
      aria-hidden="true"
      className={twMerge(
        clsx(
          'fixed inset-0 pointer-events-none z-0 overflow-hidden select-none [contain:strict]',
          className,
        ),
      )}
    >
      {ready?.data ? (
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-[var(--d-slow)] ease-[var(--ease-out)]"
          style={{
            backgroundImage: `url(${ready.data})`,
            opacity: 'var(--bg-ambient-opacity)',
          }}
        />
      ) : ready ? (
        // Cover could not be read into a canvas (no CORS): fall back to a CSS
        // blur, but on a small layer that is scaled up so the blur stays cheap.
        <div
          className="absolute left-0 top-0 w-[12.5%] h-[12.5%] origin-top-left scale-[8] bg-cover bg-center will-change-transform"
          style={{
            backgroundImage: `url(${ready.src})`,
            filter: 'blur(12px) saturate(1.4)',
            opacity: 'var(--bg-ambient-opacity)',
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 20%, color-mix(in oklab, var(--accent) 12%, transparent) 0%, transparent 100%)',
          }}
        />
      )}
    </div>
  );
};
