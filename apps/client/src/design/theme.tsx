import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../db';

export type AppTheme = 'dark' | 'light' | 'system';

export const ACCENT_PRESETS: Record<string, string> = {
  sky: '#4cc2ff',
  iris: '#8b7cf6',
  rose: '#ff6b9a',
  ember: '#ff8a3d',
  gold: '#f5c542',
  jade: '#3ccf91',
  teal: '#2ec4b6',
  slate: '#9aa7b8',
};

export interface ThemeSettings {
  theme: AppTheme;
  accent: string; // hex or 'dynamic'
  ambientEnabled: boolean;
  ambientStrength: number; // 0 to 60 (percent)
  coverGlow: boolean;
  density: 'comfortable' | 'compact';
}

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  theme: 'dark',
  accent: 'dynamic',
  ambientEnabled: true,
  ambientStrength: 32,
  coverGlow: true,
  density: 'comfortable',
};

interface ThemeContextType {
  settings: ThemeSettings;
  updateSettings: (updates: Partial<ThemeSettings>) => void;
  activeCoverUrl: string | null;
  setActiveCoverUrl: (url: string | null) => void;
  resolvedTheme: 'dark' | 'light';
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    try {
      const saved = localStorage.getItem('folio_appearance');
      return saved ? { ...DEFAULT_THEME_SETTINGS, ...JSON.parse(saved) } : DEFAULT_THEME_SETTINGS;
    } catch {
      return DEFAULT_THEME_SETTINGS;
    }
  });

  const [activeCoverUrl, setActiveCoverUrl] = useState<string | null>(null);
  const [systemIsDark, setSystemIsDark] = useState(() => {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'dark' | 'light' =
    settings.theme === 'system' ? (systemIsDark ? 'dark' : 'light') : settings.theme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    localStorage.setItem('folio_appearance', JSON.stringify(settings));

    // Ambient opacity
    const opacity = settings.ambientEnabled ? settings.ambientStrength / 100 : 0;
    document.documentElement.style.setProperty('--bg-ambient-opacity', String(opacity));

    // Accent handling
    if (settings.accent !== 'dynamic') {
      const hex = ACCENT_PRESETS[settings.accent] || settings.accent;
      document.documentElement.style.setProperty('--accent', hex);
    }
  }, [resolvedTheme, settings]);

  const updateSettings = (updates: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  };

  return (
    <ThemeContext.Provider
      value={{
        settings,
        updateSettings,
        activeCoverUrl,
        setActiveCoverUrl,
        resolvedTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/**
 * Extracts dominant color from a book's cover image using 32x32 canvas,
 * caching the result in books.meta.accent.
 */
export async function extractCoverColor(coverBlob: Blob, isDark: boolean): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(coverBlob);
    img.src = url;

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(isDark ? '#4cc2ff' : '#005fb8');
        return;
      }

      ctx.drawImage(img, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;

      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;

        // Take sufficiently saturated pixels
        if (sat > 0.15) {
          rSum += r;
          gSum += g;
          bSum += b;
          count++;
        }
      }

      if (count === 0) {
        resolve(isDark ? '#4cc2ff' : '#005fb8');
        return;
      }

      const avgR = Math.round(rSum / count);
      const avgG = Math.round(gSum / count);
      const avgB = Math.round(bSum / count);

      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      resolve(`#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(isDark ? '#4cc2ff' : '#005fb8');
    };
  });
}

/**
 * Hook to get or extract cover color for a book.
 */
export function useCoverColor(bookId: string | undefined) {
  const { resolvedTheme } = useTheme();
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;
    let alive = true;

    void db.books.get(bookId).then(async (book) => {
      if (!book || !alive) return;
      if (book.meta.accent) {
        setAccent(book.meta.accent);
        return;
      }

      if (book.cover_hash) {
        const cover = await db.covers.get(book.id);
        if (cover && alive) {
          const color = await extractCoverColor(cover.blob, resolvedTheme === 'dark');
          if (alive) {
            setAccent(color);
            // Cache in book.meta.accent
            await db.books.update(bookId, {
              meta: { ...book.meta, accent: color },
            });
          }
        }
      }
    });

    return () => {
      alive = false;
    };
  }, [bookId, resolvedTheme]);

  return accent;
}
