import { useLiveQuery } from 'dexie-react-hooks';
import { db, dirty, type SettingsRow } from '../db';
import { sha256 } from './hash';

export interface CustomFontRecord {
  id: string;
  name: string;
  fileHash: string;
  fileName: string;
  format: 'truetype' | 'opentype' | 'woff2' | 'woff';
  addedAt: number;
}

// In-memory cache of created blob URLs for font faces
const activeFontUrls = new Map<string, string>();

export async function getCustomFonts(): Promise<CustomFontRecord[]> {
  const row = await db.settings.get('custom_fonts');
  if (!row || !row.data || !Array.isArray(row.data.fonts)) return [];
  return row.data.fonts as CustomFontRecord[];
}

export async function saveCustomFonts(fonts: CustomFontRecord[]): Promise<void> {
  const record: SettingsRow = {
    id: 'custom_fonts',
    data: { fonts: fonts as unknown as Record<string, unknown>[] },
    deleted_at: null,
    ...dirty(),
  };
  await db.settings.put(record);
}

export function detectFontFormat(fileName: string): 'truetype' | 'opentype' | 'woff2' | 'woff' {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'woff2') return 'woff2';
  if (ext === 'woff') return 'woff';
  if (ext === 'otf') return 'opentype';
  return 'truetype';
}

export async function fileToArrayBuffer(file: Blob | File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Imports a custom TTF/OTF/WOFF2 font file, stores the blob in db.files,
 * and adds an entry to db.settings('custom_fonts').
 */
export async function importCustomFont(file: File): Promise<CustomFontRecord> {
  const buffer = await fileToArrayBuffer(file);
  const hash = await sha256(buffer);
  const blob = new Blob([buffer], { type: file.type || 'font/ttf' });

  // Store font blob in db.files
  await db.files.put({
    hash,
    blob,
  });

  const fontName = file.name.replace(/\.[^/.]+$/, '').trim();
  const format = detectFontFormat(file.name);
  const id = `font-${hash.slice(0, 12)}`;

  const newRecord: CustomFontRecord = {
    id,
    name: fontName,
    fileHash: hash,
    fileName: file.name,
    format,
    addedAt: Date.now(),
  };

  const existing = await getCustomFonts();
  const updated = [...existing.filter((f) => f.fileHash !== hash), newRecord];
  await saveCustomFonts(updated);

  return newRecord;
}

/**
 * Removes a custom font.
 */
export async function removeCustomFont(fontId: string): Promise<void> {
  const existing = await getCustomFonts();
  const fontToRemove = existing.find((f) => f.id === fontId);
  if (fontToRemove) {
    const blobUrl = activeFontUrls.get(fontToRemove.fileHash);
    if (blobUrl) {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(blobUrl);
      }
      activeFontUrls.delete(fontToRemove.fileHash);
    }
  }
  const updated = existing.filter((f) => f.id !== fontId);
  await saveCustomFonts(updated);
}

/**
 * Generates @font-face CSS rules for all available custom fonts.
 */
export async function loadCustomFontFaceCSS(): Promise<string> {
  const fonts = await getCustomFonts();
  if (fonts.length === 0) return '';

  const cssRules: string[] = [];

  for (const font of fonts) {
    let blobUrl = activeFontUrls.get(font.fileHash);
    if (!blobUrl) {
      const fileRecord = await db.files.get(font.fileHash);
      if (fileRecord?.blob) {
        blobUrl = typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(fileRecord.blob)
          : `blob:font-${font.fileHash}`;
        activeFontUrls.set(font.fileHash, blobUrl);
      }
    }

    if (blobUrl) {
      cssRules.push(`
@font-face {
  font-family: "${font.name}";
  src: url("${blobUrl}") format("${font.format}");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`);
    }
  }

  return cssRules.join('\n');
}

/**
 * Hook to retrieve available custom fonts with live updates.
 */
export function useCustomFonts(): {
  fonts: CustomFontRecord[];
  importFont: (file: File) => Promise<CustomFontRecord>;
  removeFont: (id: string) => Promise<void>;
} {
  const row = useLiveQuery(() => db.settings.get('custom_fonts'), []);

  const fonts: CustomFontRecord[] =
    row?.data && Array.isArray(row.data.fonts) ? (row.data.fonts as CustomFontRecord[]) : [];

  return {
    fonts,
    importFont: importCustomFont,
    removeFont: removeCustomFont,
  };
}
