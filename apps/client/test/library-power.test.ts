import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { db, dirty, uid, type Book } from '../src/db';
import { setFavorite } from '../src/lib/favourites';

describe('Phase 5: Library Power Features', () => {
  beforeEach(async () => {
    await db.books.clear();
    await db.collections.clear();
    await db.collection_books.clear();
    await db.progress.clear();
    await db.files.clear();
  });

  describe('P5.1: Multi-Select & Bulk Operations', () => {
    it('bulk-adds 200 books to a collection in under 1 second with dirty tracking', async () => {
      const colId = uid();
      await db.collections.add({
        id: colId,
        name: 'Sci-Fi Classics',
        sort_order: 0,
        deleted_at: null,
        ...dirty(),
      });

      // Prepare 200 book rows
      const bookRows: Book[] = [];
      const bookIds: string[] = [];
      for (let i = 0; i < 200; i++) {
        const id = `book-${i}`;
        bookIds.push(id);
        bookRows.push({
          id,
          title: `Book ${i}`,
          author: `Author ${i}`,
          format: 'EPUB',
          file_hash: `hash-${i}`,
          file_size: 1024 * (i + 1),
          cover_hash: null,
          meta: { file_name: `book-${i}.epub`, mime: 'application/epub+zip' },
          added_at: Date.now(),
          last_opened_at: null,
          deleted_at: null,
          ...dirty(),
        });
      }
      await db.books.bulkAdd(bookRows);

      // Measure bulk collection assignment time
      const start = performance.now();
      await db.transaction('rw', db.collection_books, async () => {
        for (const bId of bookIds) {
          await db.collection_books.put({
            id: `${colId}:${bId}`,
            collection_id: colId,
            book_id: bId,
            deleted_at: null,
            ...dirty(),
          });
        }
      });
      const durationMs = performance.now() - start;

      // Acceptance criterion: under 1s
      expect(durationMs).toBeLessThan(1000);

      // Verify all 200 are in collection_books with _dirty = 1
      const count = await db.collection_books
        .where('collection_id')
        .equals(colId)
        .count();
      expect(count).toBe(200);

      const sample = await db.collection_books.get(`${colId}:book-42`);
      expect(sample).toBeDefined();
      expect(sample?._dirty).toBe(1);
      expect(sample?.deleted_at).toBeNull();
    });

    it('bulk toggles favourites across multiple books', async () => {
      const ids = ['book-a', 'book-b', 'book-c'];
      await db.transaction('rw', db.collection_books, async () => {
        for (const id of ids) {
          await setFavorite(id, true);
        }
      });

      const favs = await db.collection_books
        .where('collection_id')
        .equals('favorites')
        .filter((r) => !r.deleted_at)
        .toArray();
      expect(favs).toHaveLength(3);
      expect(favs.map((f) => f.book_id).sort()).toEqual(ids.sort());
    });
  });

  describe('P5.2: Metadata Editing without modifying file hash', () => {
    it('updates title, author, series, volume number, tags, and rating while preserving file hash', async () => {
      const initialBook: Book = {
        id: 'hash-abc-123',
        title: 'Original Title',
        author: 'Original Author',
        format: 'EPUB',
        file_hash: 'hash-abc-123',
        file_size: 50000,
        cover_hash: 'initial-cover-hash',
        meta: {
          file_name: 'original.epub',
          mime: 'application/epub+zip',
          series: 'Fantasy Saga',
          series_number: 1,
        },
        added_at: 1000000,
        last_opened_at: null,
        deleted_at: null,
        ...dirty(),
      };
      await db.books.add(initialBook);

      // Simulate edit metadata
      const updatedMeta = {
        ...initialBook.meta,
        series: 'Fantasy Saga (Remastered)',
        series_number: 2,
        tags: ['magic', 'epic'],
        rating: 5,
        language: 'en',
        description: 'An updated epic journey.',
      };

      await db.books.update(initialBook.id, {
        title: 'Revised Title',
        author: 'Revised Author',
        meta: updatedMeta,
        ...dirty(),
      });

      const persisted = await db.books.get(initialBook.id);
      expect(persisted).toBeDefined();
      expect(persisted?.title).toBe('Revised Title');
      expect(persisted?.author).toBe('Revised Author');
      expect(persisted?.meta.series).toBe('Fantasy Saga (Remastered)');
      expect(persisted?.meta.series_number).toBe(2);
      expect(persisted?.meta.rating).toBe(5);
      expect(persisted?.meta.tags).toEqual(['magic', 'epic']);
      // Original file hash is untouched
      expect(persisted?.file_hash).toBe('hash-abc-123');
      expect(persisted?._dirty).toBe(1);
    });
  });

  describe('P5.3: Series Grouping and Progress Calculations', () => {
    it('calculates average series progress and identifies volumes correctly', async () => {
      const seriesBooks: Book[] = [
        {
          id: 'vol-1',
          title: 'Foundation',
          author: 'Isaac Asimov',
          format: 'EPUB',
          file_hash: 'h-1',
          file_size: 1000,
          cover_hash: null,
          meta: { file_name: 'vol1.epub', mime: 'application/epub+zip', series: 'Foundation', series_number: 1 },
          added_at: 1,
          last_opened_at: null,
          deleted_at: null,
          ...dirty(),
        },
        {
          id: 'vol-2',
          title: 'Foundation and Empire',
          author: 'Isaac Asimov',
          format: 'EPUB',
          file_hash: 'h-2',
          file_size: 1000,
          cover_hash: null,
          meta: { file_name: 'vol2.epub', mime: 'application/epub+zip', series: 'Foundation', series_number: 2 },
          added_at: 2,
          last_opened_at: null,
          deleted_at: null,
          ...dirty(),
        },
        {
          id: 'vol-3',
          title: 'Second Foundation',
          author: 'Isaac Asimov',
          format: 'EPUB',
          file_hash: 'h-3',
          file_size: 1000,
          cover_hash: null,
          meta: { file_name: 'vol3.epub', mime: 'application/epub+zip', series: 'Foundation', series_number: 3 },
          added_at: 3,
          last_opened_at: null,
          deleted_at: null,
          ...dirty(),
        },
      ];

      await db.books.bulkAdd(seriesBooks);

      // Volume 1 is 100% finished
      await db.progress.put({
        id: 'vol-1',
        cfi: 'cfi-1',
        percent: 1.0,
        chapter: 'The Psychohistorians',
        device_id: 'dev-1',
        deleted_at: null,
        ...dirty(),
      });

      // Volume 2 is 50% read
      await db.progress.put({
        id: 'vol-2',
        cfi: 'cfi-2',
        percent: 0.5,
        chapter: 'The General',
        device_id: 'dev-1',
        deleted_at: null,
        ...dirty(),
      });

      // Volume 3 is unread (0%)
      const p1 = (await db.progress.get('vol-1'))?.percent ?? 0;
      const p2 = (await db.progress.get('vol-2'))?.percent ?? 0;
      const p3 = (await db.progress.get('vol-3'))?.percent ?? 0;

      const combinedPct = Math.round(((p1 + p2 + p3) / 3) * 100);
      expect(combinedPct).toBe(50); // (1.0 + 0.5 + 0) / 3 = 50%
    });
  });

  describe('P5.4: Finished Automation & Badging', () => {
    it('sets finished_at timestamp when marked finished and clears when marked unread', async () => {
      const book: Book = {
        id: 'fin-book',
        title: 'Finished Book',
        author: 'Author',
        format: 'EPUB',
        file_hash: 'fin-hash',
        file_size: 2000,
        cover_hash: null,
        meta: { file_name: 'fin.epub', mime: 'application/epub+zip' },
        added_at: 1,
        last_opened_at: null,
        deleted_at: null,
        ...dirty(),
      };
      await db.books.add(book);

      const nowMs = Date.now();
      await db.books.update(book.id, {
        meta: { ...book.meta, finished_at: nowMs },
        ...dirty(),
      });

      let updated = await db.books.get(book.id);
      expect(updated?.meta.finished_at).toBe(nowMs);

      // Mark unread
      await db.books.update(book.id, {
        meta: { ...book.meta, finished_at: null },
        ...dirty(),
      });
      updated = await db.books.get(book.id);
      expect(updated?.meta.finished_at).toBeNull();
    });
  });

  describe('P5.5: Duplicate Detection Logic', () => {
    it('identifies existing book with matching normalized title and author', async () => {
      const existing: Book = {
        id: 'existing-hash',
        title: 'Dune',
        author: 'Frank Herbert',
        format: 'EPUB',
        file_hash: 'existing-hash',
        file_size: 1500000,
        cover_hash: null,
        meta: { file_name: 'dune.epub', mime: 'application/epub+zip' },
        added_at: 1,
        last_opened_at: null,
        deleted_at: null,
        ...dirty(),
      };
      await db.books.add(existing);

      const incomingTitle = '  dune ';
      const incomingAuthor = 'Frank Herbert  ';
      const incomingHash = 'new-distinct-file-hash';

      const match = await db.books
        .filter(
          (b) =>
            !b.deleted_at &&
            b.title.trim().toLowerCase() === incomingTitle.trim().toLowerCase() &&
            b.author.trim().toLowerCase() === incomingAuthor.trim().toLowerCase() &&
            b.file_hash !== incomingHash,
        )
        .first();

      expect(match).toBeDefined();
      expect(match?.id).toBe(existing.id);
    });
  });

  describe('P5.6: ZIP Export Packaging', () => {
    it('packages multiple files into a valid JSZip archive', async () => {
      const zip = new JSZip();
      zip.file('book1.epub', new Blob(['fake epub 1 content']));
      zip.file('book2.pdf', new Blob(['fake pdf 2 content']));

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      expect(zipBlob).toBeDefined();
      expect(zipBlob.size).toBeGreaterThan(0);

      // Verify unzipping
      const loaded = await JSZip.loadAsync(zipBlob);
      expect(Object.keys(loaded.files)).toEqual(['book1.epub', 'book2.pdf']);
    });
  });
});
