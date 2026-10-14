import JSZip from 'jszip';
import { db, dirty, type Book, type Annotation, type Progress, type ReadingSession, type Series, type ChapterProgress, type SettingsRow } from '../db';
import { getBlobStore } from './blobStore';

export interface BackupMetadata {
  version: number;
  exported_at: number;
  app_version: string;
}

export interface ExportBackupOptions {
  excludeFiles?: boolean;
  excludeMangaPages?: boolean;
}

export interface ImportBackupResult {
  importedBooks: number;
  importedAnnotations: number;
  importedProgress: number;
  totalRows: number;
}

/**
 * Exports all Verso data and files into a .versobackup ZIP archive.
 */
export async function exportBackup(options?: ExportBackupOptions): Promise<Blob> {
  const zip = new JSZip();

  const metadata: BackupMetadata = {
    version: 1,
    exported_at: Date.now(),
    app_version: '0.1.0',
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  // Export database tables
  const dataFolder = zip.folder('data');
  if (dataFolder) {
    const books = await db.books.toArray();
    const progress = await db.progress.toArray();
    const annotations = await db.annotations.toArray();
    const sessions = await db.reading_sessions.toArray();
    const series = await db.series.toArray();
    const chapterProgress = await db.chapter_progress.toArray();
    const settings = await db.settings.toArray();

    dataFolder.file('books.json', JSON.stringify(books));
    dataFolder.file('progress.json', JSON.stringify(progress));
    dataFolder.file('annotations.json', JSON.stringify(annotations));
    dataFolder.file('sessions.json', JSON.stringify(sessions));
    dataFolder.file('series.json', JSON.stringify(series));
    dataFolder.file('chapter_progress.json', JSON.stringify(chapterProgress));
    dataFolder.file('settings.json', JSON.stringify(settings));
  }

  // Export raw book files
  if (!options?.excludeFiles) {
    const filesFolder = zip.folder('files');
    const coversFolder = zip.folder('covers');
    const blobStore = getBlobStore();

    const books = await db.books.filter((b) => !b.deleted_at).toArray();
    for (const b of books) {
      if (b.file_hash && filesFolder) {
        const fileBlob = await blobStore.get(b.file_hash);
        if (fileBlob) {
          const buffer = await fileBlob.arrayBuffer();
          filesFolder.file(b.file_hash, buffer);
        }
      }
      if (b.cover_hash && coversFolder) {
        // Covers are keyed by book id (restore puts them back under the file name).
        const coverRow = await db.covers.get(b.id);
        if (coverRow?.blob) {
          const buffer = await coverRow.blob.arrayBuffer();
          coversFolder.file(b.id, buffer);
        }
      }
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/**
 * Restores a .foliobackup ZIP archive into the database using Last-Write-Wins (LWW).
 */
export async function importBackup(file: File | Blob): Promise<ImportBackupResult> {
  const zip = await JSZip.loadAsync(file);

  const metaFile = zip.file('metadata.json');
  if (!metaFile) {
    throw new Error('Invalid backup file: metadata.json missing');
  }

  let totalRows = 0;
  let importedBooks = 0;
  let importedAnnotations = 0;
  let importedProgress = 0;

  // 1. Restore Books
  const booksFile = zip.file('data/books.json');
  if (booksFile) {
    const text = await booksFile.async('text');
    const rows = JSON.parse(text) as Book[];
    for (const row of rows) {
      const local = await db.books.get(row.id);
      if (!local || row.updated_at >= local.updated_at) {
        await db.books.put({ ...row, ...dirty() });
        importedBooks++;
        totalRows++;
      }
    }
  }

  // 2. Restore Progress
  const progressFile = zip.file('data/progress.json');
  if (progressFile) {
    const text = await progressFile.async('text');
    const rows = JSON.parse(text) as Progress[];
    for (const row of rows) {
      const local = await db.progress.get(row.id);
      if (!local || row.updated_at >= local.updated_at) {
        await db.progress.put({ ...row, ...dirty() });
        importedProgress++;
        totalRows++;
      }
    }
  }

  // 3. Restore Annotations
  const annotationsFile = zip.file('data/annotations.json');
  if (annotationsFile) {
    const text = await annotationsFile.async('text');
    const rows = JSON.parse(text) as Annotation[];
    for (const row of rows) {
      const local = await db.annotations.get(row.id);
      if (!local || row.updated_at >= local.updated_at) {
        await db.annotations.put({ ...row, ...dirty() });
        importedAnnotations++;
        totalRows++;
      }
    }
  }

  // 4. Restore Sessions
  const sessionsFile = zip.file('data/sessions.json');
  if (sessionsFile) {
    const text = await sessionsFile.async('text');
    const rows = JSON.parse(text) as ReadingSession[];
    for (const row of rows) {
      const local = await db.reading_sessions.get(row.id);
      if (!local || row.updated_at >= local.updated_at) {
        await db.reading_sessions.put({ ...row, ...dirty() });
        totalRows++;
      }
    }
  }

  // 5. Restore Series & Manga
  const seriesFile = zip.file('data/series.json');
  if (seriesFile) {
    const text = await seriesFile.async('text');
    const rows = JSON.parse(text) as Series[];
    for (const row of rows) {
      const local = await db.series.get(row.id);
      if (!local || (row.updated_at ?? 0) >= (local.updated_at ?? 0)) {
        await db.series.put({ ...row, ...dirty() });
        totalRows++;
      }
    }
  }

  const cpFile = zip.file('data/chapter_progress.json');
  if (cpFile) {
    const text = await cpFile.async('text');
    const rows = JSON.parse(text) as ChapterProgress[];
    for (const row of rows) {
      const local = await db.chapter_progress.get(row.id);
      if (!local || (row.updated_at ?? 0) > (local.updated_at ?? 0)) {
        await db.chapter_progress.put({ ...row, ...dirty() });
        totalRows++;
      }
    }
  }

  // 6. Restore Settings
  const settingsFile = zip.file('data/settings.json');
  if (settingsFile) {
    const text = await settingsFile.async('text');
    const rows = JSON.parse(text) as SettingsRow[];
    for (const row of rows) {
      const local = await db.settings.get(row.id);
      if (!local || row.updated_at > local.updated_at) {
        await db.settings.put({ ...row, ...dirty() });
        totalRows++;
      }
    }
  }

  // 7. Restore Files into BlobStore
  const blobStore = getBlobStore();
  const fileEntries = zip.filter((path) => path.startsWith('files/') && !path.endsWith('/'));
  for (const entry of fileEntries) {
    const hash = entry.name.replace('files/', '');
    if (hash) {
      const buffer = await entry.async('arraybuffer');
      const blob = new Blob([buffer]);
      await blobStore.put(hash, blob);
    }
  }

  // 8. Restore Covers
  const coverEntries = zip.filter((path) => path.startsWith('covers/') && !path.endsWith('/'));
  for (const entry of coverEntries) {
    const id = entry.name.replace('covers/', '');
    if (id) {
      const buffer = await entry.async('arraybuffer');
      const blob = new Blob([buffer]);
      await db.covers.put({ id, blob });
    }
  }

  return {
    importedBooks,
    importedAnnotations,
    importedProgress,
    totalRows,
  };
}

/**
 * Initiates browser download of an exported backup blob.
 */
export function downloadBackupBlob(blob: Blob, filename?: string): void {
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = filename || `verso_backup_${dateStr}.versobackup`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
