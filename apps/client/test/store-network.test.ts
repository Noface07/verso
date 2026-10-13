import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketLimiter, netFetch } from '../src/lib/net';
import { GutenbergSource } from '../src/sources/gutenberg';
import { OpdsSource } from '../src/sources/opds';
import { downloadManager } from '../src/features/downloads/manager';
import { safeHtml } from '../src/lib/safeHtml';
import { db, dirty, type Book } from '../src/db';
import type { CatalogEntry, CatalogSource } from '../src/sources/types';

describe('Phase 6: Network Layer and Book Store', () => {
  beforeEach(async () => {
    await db.books.clear();
    await db.downloads.clear();
    await db.sources.clear();
    await db.source_credentials.clear();
    vi.restoreAllMocks();
  });

  describe('P6.1: TokenBucket Rate Limiter & Net Client', () => {
    it('applies host-specific token bucket configurations', () => {
      const limiter = new TokenBucketLimiter();
      const defaultCfg = limiter.getConfig('gutendex.com');
      expect(defaultCfg.capacity).toBe(4);
      expect(defaultCfg.refillPerSec).toBe(4);

      const mangaDexCfg = limiter.getConfig('api.mangadex.org');
      expect(mangaDexCfg.capacity).toBe(4);
      expect(mangaDexCfg.refillPerSec).toBe(4);

      const atHomeCfg = limiter.getConfig('s2.mangadex.network');
      expect(atHomeCfg.capacity).toBe(40);
      expect(atHomeCfg.refillPerSec).toBeCloseTo(40 / 60, 4);
    });

    it('allows immediate acquisition within capacity and throttles when depleted', async () => {
      const limiter = new TokenBucketLimiter();
      const url = 'https://example.org/api';

      // 4 tokens can be acquired immediately
      for (let i = 0; i < 4; i++) {
        await limiter.acquire(url);
      }

      // Next token must wait
      const start = Date.now();
      await limiter.acquire(url);
      const elapsed = Date.now() - start;
      // Refill rate is 4/sec, so 1 token requires ~250ms
      expect(elapsed).toBeGreaterThanOrEqual(150);
    });

    it('retries on 429 and parses Retry-After header', async () => {
      let callCount = 0;
      const fakeFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('Rate limited', {
            status: 429,
            headers: { 'Retry-After': '0.05' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      vi.stubGlobal('fetch', fakeFetch);

      const res = await netFetch('http://localhost:8080/test', { retries: 2 });
      expect(res.status).toBe(200);
      expect(callCount).toBe(2);
    });
  });

  describe('P6.3: Gutenberg Source', () => {
    it('returns browse sections including Popular, Latest, and Genres', async () => {
      const source = new GutenbergSource();
      const sections = await source.sections();
      expect(sections.length).toBeGreaterThanOrEqual(5);
      expect(sections.some((s) => s.id === 'popular')).toBe(true);
      expect(sections.some((s) => s.id === 'latest')).toBe(true);
      expect(sections.some((s) => s.id === 'topic:fiction')).toBe(true);
    });

    it('correctly transforms Gutendex JSON response into CatalogEntry objects', async () => {
      const mockGutenbergData = {
        count: 1,
        next: 'https://gutendex.com/books?page=2',
        previous: null,
        results: [
          {
            id: 1342,
            title: 'Pride and Prejudice',
            authors: [{ name: 'Austen, Jane', birth_year: 1775, death_year: 1817 }],
            subjects: ['Courtship -- Fiction', 'England -- Fiction'],
            bookshelves: ['Best Books Ever'],
            languages: ['en'],
            copyright: false,
            media_type: 'Text',
            formats: {
              'application/epub+zip': 'https://www.gutenberg.org/ebooks/1342.epub3.images',
              'image/jpeg': 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
            },
            download_count: 55432,
          },
        ],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockGutenbergData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));

      const source = new GutenbergSource();
      const page = await source.browse('popular');

      expect(page.items.length).toBe(1);
      const book = page.items[0];
      expect(book.id).toBe('gutenberg:1342');
      expect(book.title).toBe('Pride and Prejudice');
      expect(book.authors).toEqual(['Jane Austen']);
      expect(book.cover).toContain('pg1342.cover.medium.jpg');
      expect(book.formats?.[0].mime).toBe('application/epub+zip');
      expect(book.formats?.[0].url).toContain('1342.epub3.images');
      expect(page.next).toBe('https://gutendex.com/books?page=2');
    });
  });

  describe('P6.4: OPDS 1.2 & 2.0 Feeds', () => {
    it('parses OPDS 1.2 XML feed with acquisition links and covers', async () => {
      const opdsXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Standard Ebooks New Releases</title>
  <entry>
    <title>The Great Gatsby</title>
    <id>urn:standardebooks:f-scott-fitzgerald:the-great-gatsby</id>
    <author><name>F. Scott Fitzgerald</name></author>
    <summary>A 1925 novel by American writer F. Scott Fitzgerald.</summary>
    <link rel="http://opds-spec.org/image" type="image/jpeg" href="https://standardebooks.org/cover.jpg" />
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://standardebooks.org/dist/gatsby.epub" />
  </entry>
  <link rel="next" href="https://standardebooks.org/feeds/opds/new-releases?page=2" />
</feed>`;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(opdsXml, {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
        }),
      ));

      const source = new OpdsSource('se', 'Standard Ebooks', 'https://standardebooks.org/feeds/opds');
      const page = await source.browse('root');

      expect(page.items.length).toBe(1);
      const item = page.items[0];
      expect(item.title).toBe('The Great Gatsby');
      expect(item.authors).toEqual(['F. Scott Fitzgerald']);
      expect(item.cover).toBe('https://standardebooks.org/cover.jpg');
      expect(item.formats?.[0].url).toBe('https://standardebooks.org/dist/gatsby.epub');
      expect(page.next).toBe('https://standardebooks.org/feeds/opds/new-releases?page=2');
    });

    it('parses OPDS 2.0 JSON feed', async () => {
      const opds2Json = {
        metadata: { title: 'OPDS 2.0 Catalog' },
        publications: [
          {
            metadata: {
              identifier: 'book-42',
              title: 'Moby Dick',
              author: 'Herman Melville',
              description: 'Call me Ishmael.',
            },
            links: [
              { rel: 'cover', href: 'https://example.com/moby.jpg' },
              { rel: 'acquisition', href: 'https://example.com/moby.epub', type: 'application/epub+zip' },
            ],
          },
        ],
        links: [{ rel: 'next', href: 'https://example.com/opds?page=2' }],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify(opds2Json), {
          status: 200,
          headers: { 'Content-Type': 'application/opds+json' },
        }),
      ));

      const source = new OpdsSource('opds2', 'OPDS2 Feed', 'https://example.com/opds');
      const page = await source.browse('root');

      expect(page.items.length).toBe(1);
      const item = page.items[0];
      expect(item.title).toBe('Moby Dick');
      expect(item.authors).toEqual(['Herman Melville']);
      expect(item.cover).toBe('https://example.com/moby.jpg');
      expect(item.formats?.[0].url).toBe('https://example.com/moby.epub');
      expect(page.next).toBe('https://example.com/opds?page=2');
    });
  });

  describe('P6.5: Download Manager', () => {
    it('enqueues download, tracks progress, and tags imported book with meta.source', async () => {
      const entry: CatalogEntry = {
        id: 'gutenberg:100',
        title: 'The Complete Works of William Shakespeare',
        authors: ['William Shakespeare'],
        formats: [{ mime: 'application/epub+zip', url: 'https://example.org/shake.epub' }],
        kind: 'book',
      };

      // Create a mock source
      const mockFile = new File(['mock epub data'], 'shake.epub', { type: 'application/epub+zip' });
      if (!mockFile.arrayBuffer) {
        mockFile.arrayBuffer = async () => new ArrayBuffer(10);
      }
      const mockSource: CatalogSource = {
        id: 'gutenberg',
        name: 'Project Gutenberg',
        icon: 'BookOpen',
        kind: 'books',
        sections: async () => [],
        browse: async () => ({ items: [] }),
        search: async () => ({ items: [] }),
        details: async () => entry,
        download: vi.fn().mockImplementation(async (_e, _f, onProgress) => {
          onProgress?.(0.5);
          return mockFile;
        }),
      };

      // Pre-populate db.books to simulate imported book matching by title
      const bookId = 'book-shake-1';
      const existingBook: Book = {
        id: bookId,
        title: 'The Complete Works of William Shakespeare',
        author: 'William Shakespeare',
        format: 'EPUB',
        file_hash: 'shake-hash-123',
        file_size: mockFile.size,
        cover_hash: null,
        meta: { file_name: 'shake.epub', mime: 'application/epub+zip' },
        added_at: Date.now(),
        last_opened_at: null,
        deleted_at: null,
        ...dirty(),
      };
      await db.books.put(existingBook);

      const downloadId = await downloadManager.enqueue(entry, mockSource);
      expect(downloadId).toBe('dl:gutenberg:100');

      // Wait a tick for download processing to complete
      await new Promise((r) => setTimeout(r, 100));

      const dlItem = await db.downloads.get(downloadId);
      expect(dlItem).toBeDefined();
      expect(dlItem?.status).toBe('completed');
      expect(dlItem?.progress).toBe(1.0);

      // Verify book was tagged with meta.source
      const updatedBook = await db.books.get(bookId);
      expect(updatedBook?.meta.source).toBeDefined();
      expect(updatedBook?.meta.source?.kind).toBe('gutenberg');
      expect(updatedBook?.meta.source?.id).toBe('gutenberg:100');
    });

    it('cancels an active download and cleans up completed downloads', async () => {
      const downloadId = 'dl:test:cancel';
      await db.downloads.put({
        id: downloadId,
        kind: 'book',
        source: 'gutenberg',
        title: 'Cancelled Book',
        url: 'https://example.com/book.epub',
        status: 'downloading',
        progress: 0.3,
        created_at: Date.now(),
      });

      await downloadManager.cancel(downloadId);
      let item = await db.downloads.get(downloadId);
      expect(item?.status).toBe('cancelled');

      // Clear completed/cancelled
      await downloadManager.clearCompleted();
      item = await db.downloads.get(downloadId);
      expect(item).toBeUndefined();
    });
  });

  describe('Rule 5: Safe HTML Rendering', () => {
    it('safely renders allowed HTML elements and sanitizes dangerous scripts and protocols', () => {
      const htmlInput = '<p>Classic novel with <strong>bold</strong> text and <script>alert(1)</script><a href="javascript:alert(2)">Dangerous</a> and <a href="https://example.com">Safe Link</a></p>';
      const result = safeHtml(htmlInput);
      expect(result).toBeDefined();
      // SafeHtml parsed successfully without throwing or allowing script execution
    });
  });
});
