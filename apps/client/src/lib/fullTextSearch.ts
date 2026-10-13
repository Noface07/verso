import { db, type Book } from '../db';
import { makeBook } from './foliate';

export interface FtsEntry {
  bookId: string;
  sectionIndex: number;
  text: string;
}

/**
 * Checks if a book has been indexed for full-text search in kv store.
 */
export async function isBookIndexed(bookId: string): Promise<boolean> {
  const record = await db.kv.get(`fts:${bookId}`);
  return !!record;
}

/**
 * Builds full-text search index for a book by extracting text from its sections.
 */
export async function indexBookFullText(book: Book): Promise<void> {
  const fileRow = await db.files.get(book.file_hash);
  if (!fileRow) return;

  const file = new File([fileRow.blob], book.meta.file_name || `${book.title}.epub`, {
    type: book.meta.mime || 'application/epub+zip',
  });

  try {
    const foliateBook = await makeBook(file);
    const sections = foliateBook.sections ?? [];
    const entries: { index: number; snippet: string }[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.linear === 'no' || !section.createDocument) continue;
      try {
        const doc = await section.createDocument();
        const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text) {
          // Store compressed or truncated text per section to conserve storage
          entries.push({ index: i, snippet: text.toLowerCase() });
        }
      } catch {
        // Skip unreadable sections
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    await db.kv.put({
      key: `fts:${book.id}`,
      value: entries,
    });
  } catch {
    // Ignore indexing errors on unsupported files
  }
}

/**
 * Searches across indexed books for a query string.
 * Returns set of book IDs containing the query.
 */
export async function searchFullText(query: string): Promise<Set<string>> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();

  const matchingBookIds = new Set<string>();
  const ftsKeys = await db.kv
    .filter((row) => row.key.startsWith('fts:'))
    .toArray();

  for (const item of ftsKeys) {
    const bookId = item.key.slice(4);
    const entries = item.value as { index: number; snippet: string }[] | undefined;
    if (Array.isArray(entries)) {
      const found = entries.some((e) => e.snippet.includes(q));
      if (found) {
        matchingBookIds.add(bookId);
      }
    }
  }

  return matchingBookIds;
}
