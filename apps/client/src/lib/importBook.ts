import { db, dirty, type Book } from '../db';
import { makeBook, type FoliateBook } from './foliate';
import { sha256 } from './hash';

export const ACCEPT = '.epub,.mobi,.azw3,.azw,.fb2,.fbz,.cbz,.pdf';

const FORMATS: Record<string, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  azw3: 'AZW3',
  azw: 'AZW',
  fb2: 'FB2',
  fbz: 'FB2',
  cbz: 'CBZ',
  pdf: 'PDF',
};

function text(x: unknown): string {
  if (typeof x === 'string') return x.trim();
  if (Array.isArray(x)) return text(x[0]);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if ('name' in o) return text(o.name);
    return text(Object.values(o)[0]);
  }
  return '';
}

function people(x: unknown): string {
  const list = Array.isArray(x) ? x : x ? [x] : [];
  return list.map(text).filter(Boolean).join(', ');
}

async function shrinkCover(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / bmp.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.85),
    );
  } catch {
    return blob;
  }
}

export interface ImportResult {
  added: number;
  skipped: number;
  failed: { name: string; error: string }[];
}

export interface ImportOptions {
  onProgress?: (
    index: number,
    total: number,
    file: File,
    status: 'processing' | 'done' | 'skipped' | 'error',
    error?: string,
  ) => void;
  onDuplicate?: (
    existingBook: Book,
    newFile: File,
  ) => Promise<'replace' | 'keep-both' | 'skip'>;
  signal?: AbortSignal;
}

export async function importFiles(
  files: File[],
  options?: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = { added: 0, skipped: 0, failed: [] };
  const total = files.length;

  for (let i = 0; i < total; i++) {
    if (options?.signal?.aborted) {
      break;
    }
    const file = files[i];
    options?.onProgress?.(i, total, file, 'processing');

    try {
      const outcome = await importOne(file, options);
      if (outcome) {
        result.added++;
        options?.onProgress?.(i, total, file, 'done');
      } else {
        result.skipped++;
        options?.onProgress?.(i, total, file, 'skipped');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push({ name: file.name, error: msg });
      options?.onProgress?.(i, total, file, 'error', msg);
    }
  }

  return result;
}

export async function importOne(
  file: File,
  options?: ImportOptions,
): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const hash = await sha256(await file.arrayBuffer());
  const existing = await db.books.get(hash);
  if (existing && !existing.deleted_at) {
    const hasFile = await db.files.get(hash);
    if (!hasFile) {
      await db.files.put({ hash, blob: file });
      try {
        const book = await makeBook(file);
        const rawCover = await book.getCover?.();
        if (rawCover) {
          const coverBlob = await shrinkCover(rawCover);
          await db.covers.put({ id: hash, blob: coverBlob });
          // Keep cover_hash matching the stored image, or the cover can't sync.
          await db.books.update(hash, { cover_hash: await sha256(await coverBlob.arrayBuffer()), ...dirty() });
        }
      } catch {
        // cover extraction is optional
      }
      return true;
    }
    return false;
  }

  const book = await makeBook(file);
  const md = book.metadata ?? {};

  const title = text(md.title) || file.name.replace(/\.[^.]+$/, '');
  const author = people(md.author) || 'Unknown author';
  const normTitle = title.trim().toLowerCase();
  const normAuthor = author.trim().toLowerCase();

  // Duplicate detection by title and author with differing hash
  const potentialDup = await db.books
    .filter(
      (b) =>
        !b.deleted_at &&
        b.title.trim().toLowerCase() === normTitle &&
        b.author.trim().toLowerCase() === normAuthor &&
        b.file_hash !== hash,
    )
    .first();

  let coverBlob: Blob | null = null;
  let coverHash: string | null = null;
  try {
    const rawCover = await book.getCover?.();
    if (rawCover) {
      coverBlob = await shrinkCover(rawCover);
      coverHash = await sha256(await coverBlob.arrayBuffer());
    }
  } catch {
    // Ignore broken cover images; fallback to generated cover
  }

  if (potentialDup) {
    const decision = options?.onDuplicate
      ? await options.onDuplicate(potentialDup, file)
      : 'keep-both';

    if (decision === 'skip') {
      return false;
    }

    if (decision === 'replace') {
      await db.files.put({ hash, blob: file });
      if (coverBlob) {
        await db.covers.put({ id: potentialDup.id, blob: coverBlob });
      }
      await db.books.update(potentialDup.id, {
        file_hash: hash,
        file_size: file.size,
        format: FORMATS[ext] ?? ext.toUpperCase(),
        cover_hash: coverHash ?? potentialDup.cover_hash,
        ...dirty(),
      });
      enqueueWordCount(potentialDup.id, book, FORMATS[ext] ?? ext.toUpperCase());
      return true;
    }
    // If 'keep-both', proceed with normal import
  }

  if (coverBlob) {
    await db.covers.put({ id: hash, blob: coverBlob });
  }

  await db.files.put({ hash, blob: file });

  const t = Date.now();
  const row: Book = {
    id: hash,
    title,
    author,
    format: FORMATS[ext] ?? ext.toUpperCase(),
    file_hash: hash,
    file_size: file.size,
    cover_hash: coverHash,
    meta: {
      file_name: file.name,
      mime: file.type,
      language: text(md.language),
      publisher: people(md.publisher),
      description: text(md.description)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      series: text(
        (md.belongsTo as Record<string, unknown> | undefined)?.series,
      ),
    },
    added_at: existing?.added_at ?? t,
    last_opened_at: existing?.last_opened_at ?? null,
    deleted_at: null,
    ...dirty(),
  };

  await db.books.put(row);
  enqueueWordCount(hash, book, row.format);
  return true;
}

/**
 * Stores a cover for a book that has none on this device, taken from the opened
 * book or from the local file. Sets cover_hash to the new image so it syncs.
 */
export async function backfillCover(bookId: string, foliateBook?: FoliateBook): Promise<boolean> {
  if (await db.covers.get(bookId)) return false;
  let fb = foliateBook;
  if (!fb) {
    const row = await db.books.get(bookId);
    const file = row ? await db.files.get(row.file_hash) : undefined;
    if (!row || !file) return false;
    fb = await makeBook(
      new File([file.blob], row.meta.file_name || `book.${row.format.toLowerCase()}`, {
        type: row.meta.mime || file.blob.type,
      }),
    );
  }
  const raw = await fb.getCover?.();
  if (!raw) return false;
  const blob = await shrinkCover(raw);
  await db.covers.put({ id: bookId, blob });
  await db.books.update(bookId, { cover_hash: await sha256(await blob.arrayBuffer()), ...dirty() });
  return true;
}

// Background Word Count Processing Queue
interface WordCountJob {
  bookId: string;
  book: FoliateBook;
  format: string;
}

const wordCountQueue: WordCountJob[] = [];
let isProcessingQueue = false;

function enqueueWordCount(bookId: string, book: FoliateBook, format: string) {
  if (format === 'PDF' || format === 'CBZ' || book.rendition?.layout === 'pre-paginated') {
    return;
  }
  wordCountQueue.push({ bookId, book, format });
  if (!isProcessingQueue) {
    void processWordCountQueue();
  }
}

async function processWordCountQueue() {
  if (wordCountQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }

  isProcessingQueue = true;
  const job = wordCountQueue.shift();
  if (job) {
    try {
      await countText(job.bookId, job.book);
    } catch {
      // Ignore background counting errors
    }
  }

  // Yield to browser frame before next item in queue
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => void processWordCountQueue());
  } else {
    setTimeout(() => void processWordCountQueue(), 50);
  }
}

async function countText(id: string, book: FoliateBook) {
  let words = 0;
  let paragraphs = 0;
  const sections = book.sections ?? [];

  for (const section of sections) {
    if (section.linear === 'no' || !section.createDocument) continue;
    try {
      const doc = await section.createDocument();
      words +=
        (doc.body?.textContent ?? '').match(
          /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu,
        )?.length ?? 0;
      paragraphs += doc.querySelectorAll(
        'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd',
      ).length;
    } catch {
      // Skip unreadable sections
    }
    // Non-blocking tick between sections
    await new Promise((r) => setTimeout(r, 0));
  }

  const current = await db.books.get(id);
  if (current) {
    await db.books.update(id, {
      meta: { ...current.meta, word_count: words, paragraph_count: paragraphs },
      ...dirty(),
    });
  }
}