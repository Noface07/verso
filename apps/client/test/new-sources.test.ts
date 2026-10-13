import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db';
import { OpenLibrarySource } from '../src/sources/openlibrary';
import { ArchiveOrgSource } from '../src/sources/archiveorg';
import { MangaPillSource } from '../src/sources/mangapill';
import { SuwayomiSource } from '../src/sources/suwayomi';
import { KomgaSource } from '../src/sources/komga';
import {
  getAllBookSources,
  getAllMangaSources,
  getSourceById,
  addCustomSuwayomiSource,
  addCustomKomgaSource,
} from '../src/sources/registry';

describe('New Manga & Book Sources (Tachiyomi, Suwayomi, Mihon, Kotatsu)', () => {
  beforeEach(async () => {
    await db.sources.clear();
    await db.source_credentials.clear();
    await db.series.clear();
    await db.chapter_progress.clear();
    await db.manga_pages.clear();
    vi.restoreAllMocks();
  });

  describe('Open Library Book Source', () => {
    it('provides standard sections for trending, classics, fiction, fantasy, etc.', async () => {
      const src = new OpenLibrarySource();
      const sections = await src.sections();
      expect(sections.length).toBeGreaterThanOrEqual(6);
      expect(sections.map((s) => s.id)).toContain('trending');
      expect(sections.map((s) => s.id)).toContain('classics');
      expect(sections.map((s) => s.id)).toContain('fiction');
    });

    it('transforms Open Library search results with covers and IA formats', async () => {
      const mockSearch = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL12345W',
            title: 'The Hobbit',
            author_name: ['J.R.R. Tolkien'],
            cover_i: 998877,
            first_publish_year: 1937,
            subject: ['Fantasy', 'Middle-earth'],
            ia: ['thehobbit1937tolk'],
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockSearch), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const src = new OpenLibrarySource();
      const page = await src.search('The Hobbit');
      expect(page.items.length).toBe(1);

      const book = page.items[0];
      expect(book.id).toBe('openlibrary:OL12345W');
      expect(book.title).toBe('The Hobbit');
      expect(book.authors).toEqual(['J.R.R. Tolkien']);
      expect(book.cover).toBe('https://covers.openlibrary.org/b/id/998877-M.jpg');
      expect(book.kind).toBe('book');
      expect(book.formats?.[0]?.url).toBe(
        'https://archive.org/download/thehobbit1937tolk/thehobbit1937tolk.epub',
      );
    });

    it('maps id_project_gutenberg to direct Gutenberg EPUB downloads', async () => {
      const mockSearch = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL66554W',
            title: 'Pride and Prejudice',
            author_name: ['Jane Austen'],
            id_project_gutenberg: ['1342'],
            ebook_access: 'public',
            has_fulltext: true,
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockSearch), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const src = new OpenLibrarySource();
      const page = await src.search('Pride and Prejudice');
      const book = page.items[0];
      expect(book.formats?.[0]?.url).toBe('https://www.gutenberg.org/ebooks/1342.epub3.images');
      expect(book.formats?.[1]?.url).toBe('https://www.gutenberg.org/ebooks/1342.epub.noimages');
    });

    it('identifies in-copyright lending titles and leaves formats empty', async () => {
      const mockSearch = {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL19747805W',
            title: 'Atomic Habits',
            author_name: ['James Clear'],
            ebook_access: 'printdisabled',
            ia: ['atomichabits0000clea'],
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockSearch), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const src = new OpenLibrarySource();
      const page = await src.search('Atomic Habits');
      const book = page.items[0];
      expect(book.formats).toEqual([]);
    });
  });

  describe('Internet Archive Books Source', () => {
    it('provides standard sections and queries mediatype:texts AND format:EPUB', async () => {
      const src = new ArchiveOrgSource();
      const sections = await src.sections();
      expect(sections.map((s) => s.id)).toContain('popular');
      expect(sections.map((s) => s.id)).toContain('gutenberg');
      expect(sections.map((s) => s.id)).toContain('folkscanomy');
    });

    it('transforms Archive.org search results with covers and EPUB links', async () => {
      const mockResponse = {
        response: {
          numFound: 1,
          start: 0,
          docs: [
            {
              identifier: 'prideandprejudice00aust',
              title: 'Pride and Prejudice',
              creator: 'Jane Austen',
              description: 'Classic romantic novel of manners.',
              year: 1813,
              downloads: 45000,
            },
          ],
        },
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const src = new ArchiveOrgSource();
      const page = await src.search('Pride and Prejudice');
      expect(page.items.length).toBe(1);

      const book = page.items[0];
      expect(book.id).toBe('archiveorg:prideandprejudice00aust');
      expect(book.title).toBe('Pride and Prejudice');
      expect(book.authors).toEqual(['Jane Austen']);
      expect(book.cover).toBe(
        'https://archive.org/services/img/prideandprejudice00aust',
      );
      expect(book.formats?.[0]?.url).toBe(
        'https://archive.org/download/prideandprejudice00aust/prideandprejudice00aust.epub',
      );
    });
  });

  describe('MangaPill Source (Kotatsu / Tachiyomi staple)', () => {
    it('returns standard sections and parses manga cards from HTML', async () => {
      const src = new MangaPillSource();
      const sections = await src.sections();
      expect(sections.map((s) => s.id)).toEqual(['popular', 'new', 'recent']);

      const mockHtml = `
        <div class="grid">
          <a href="/manga/123/chainsaw-man">
            <img data-src="https://cdn.example.com/cover123.jpg" />
            <div>Chainsaw Man</div>
          </a>
        </div>
      `;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(mockHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      );

      const page = await src.browse('popular');
      expect(page.items.length).toBe(1);
      expect(page.items[0].id).toBe('mangapill:123:chainsaw-man');
      expect(page.items[0].title).toBe('Chainsaw Man');
      expect(page.items[0].cover).toBe('https://cdn.example.com/cover123.jpg');
      expect(page.items[0].kind).toBe('manga');
    });

    it('parses chapter list and page image URLs', async () => {
      const src = new MangaPillSource();
      const mockDetailHtml = `
        <h1>Chainsaw Man</h1>
        <div class="chapters">
          <a href="/chapters/123-10001000/chainsaw-man-chapter-1">Chapter 1</a>
          <a href="/chapters/123-10002000/chainsaw-man-chapter-2">Chapter 2</a>
        </div>
      `;

      const mockChapterHtml = `
        <div class="pages">
          <img data-src="https://cdn.example.com/ch1/1.jpeg" class="js-page" />
          <img data-src="https://cdn.example.com/ch1/2.jpeg" class="js-page" />
        </div>
      `;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          const decoded = decodeURIComponent(url);
          if (decoded.includes('/chapters')) {
            return new Response(mockChapterHtml, { status: 200 });
          }
          return new Response(mockDetailHtml, { status: 200 });
        }),
      );

      const chapters = await src.chapters('mangapill:123:chainsaw-man');
      expect(chapters.length).toBe(2);
      expect(chapters[0].title).toBe('Chapter 1');
      expect(chapters[0].number).toBe(1);

      const pages = await src.pages(chapters[0].id);
      expect(pages.length).toBe(2);
      expect(pages[0].url).toBe('https://cdn.example.com/ch1/1.jpeg');
      expect(pages[1].url).toBe('https://cdn.example.com/ch1/2.jpeg');
    });

    it('parses realistic MangaPill HTML with class before href and proxies CDN images', async () => {
      const src = new MangaPillSource();
      const mockSearchHtml = `
        <div class="grid">
          <div>
            <a class="relative block" href="/manga/2/one-piece">
              <figure>
                <img data-src="https://cdn.readdetectiveconan.com/file/mangapill/i/2.webp" />
              </figure>
            </a>
            <div>
              <a class="text-secondary" href="/manga/2/one-piece">
                <div>One Piece</div>
              </a>
            </div>
          </div>
        </div>
      `;

      const mockChaptersHtml = `
        <h1>One Piece</h1>
        <div class="chapters">
          <a class="border p-2" href="/chapters/2-11195000/one-piece-chapter-1195">Chapter 1195</a>
        </div>
      `;

      const mockPagesHtml = `
        <div class="pages">
          <img data-src="https://cdn.readdetectiveconan.com/file/mangap/2026/42/2/11195000/1.jpeg" />
        </div>
      `;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          const decoded = decodeURIComponent(url);
          if (decoded.includes('/chapters/')) {
            return new Response(mockPagesHtml, { status: 200 });
          }
          if (decoded.includes('/manga/')) {
            return new Response(mockChaptersHtml, { status: 200 });
          }
          return new Response(mockSearchHtml, { status: 200 });
        }),
      );

      const search = await src.search('one piece');
      expect(search.items.length).toBe(1);
      expect(search.items[0].title).toBe('One Piece');
      // Proxies cdn.readdetectiveconan.com
      expect(search.items[0].cover).toContain('/proxy?url=');

      const chapters = await src.chapters('mangapill:2:one-piece');
      expect(chapters.length).toBe(1);
      expect(chapters[0].title).toBe('Chapter 1195');

      const pages = await src.pages(chapters[0].id);
      expect(pages.length).toBe(1);
      expect(pages[0].url).toContain('/proxy?url=');
    });
  });

  describe('Suwayomi Source (Tachiyomi & Mihon extensions server)', () => {
    it('discovers installed Tachiyomi extensions and builds catalog sections', async () => {
      const mockExtensions = [
        { id: '1001', name: 'MangaKakalot', lang: 'en' },
        { id: '1002', name: 'Asura Scans', lang: 'en' },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockExtensions), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const src = new SuwayomiSource('suwa-1', 'Local Suwayomi', 'http://localhost:4567');
      const sections = await src.sections();
      expect(sections.length).toBe(2);
      expect(sections[0].id).toBe('1001');
      expect(sections[0].title).toContain('MangaKakalot');
      expect(sections[1].id).toBe('1002');
    });

    it('browses extension manga, fetches details, chapters and pages', async () => {
      const mockExtensions = [{ id: '1001', name: 'MangaKakalot', lang: 'en' }];
      const mockMangaList = {
        mangaList: [
          {
            id: 555,
            sourceId: '1001',
            title: 'Solo Leveling',
            thumbnailUrl: '/api/v1/manga/555/thumbnail',
            author: 'Chugong',
          },
        ],
        hasNextPage: true,
      };
      const mockChapters = [
        {
          id: 999,
          name: 'Chapter 179 (End)',
          chapterNumber: 179,
          uploadDate: 1640000000000,
          pageCount: 15,
        },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/source/list')) {
            return new Response(JSON.stringify(mockExtensions), { status: 200 });
          }
          if (url.includes('/popular/')) {
            return new Response(JSON.stringify(mockMangaList), { status: 200 });
          }
          if (url.includes('/chapters')) {
            return new Response(JSON.stringify(mockChapters), { status: 200 });
          }
          return new Response(JSON.stringify({ id: 999, pageCount: 3 }), { status: 200 });
        }),
      );

      const src = new SuwayomiSource('suwa-1', 'Local Suwayomi', 'http://localhost:4567');
      const page = await src.browse('1001');
      expect(page.items.length).toBe(1);
      expect(page.items[0].title).toBe('Solo Leveling');
      expect(page.items[0].cover).toBe('http://localhost:4567/api/v1/manga/555/thumbnail');

      const chapters = await src.chapters('suwayomi:suwa-1:1001:555');
      expect(chapters.length).toBe(1);
      expect(chapters[0].id).toBe('999');
      expect(chapters[0].number).toBe(179);

      const pages = await src.pages('999');
      expect(pages.length).toBe(3);
      expect(pages[0].url).toBe('http://localhost:4567/api/v1/chapter/999/page/0');
    });
  });

  describe('Komga Source (Self-hosted comics/manga)', () => {
    it('browses series, books, and page streaming URLs', async () => {
      const mockSeries = {
        content: [
          {
            id: 'series-1',
            name: 'Berserk Deluxe',
            booksCount: 14,
            metadata: { status: 'ONGOING' },
          },
        ],
        last: true,
      };

      const mockBooks = {
        content: [
          {
            id: 'book-1',
            name: 'Volume 1',
            number: 1,
            media: { pagesCount: 200 },
          },
        ],
      };

      const mockPages = [
        { number: 1, fileName: '001.jpg', mediaType: 'image/jpeg' },
        { number: 2, fileName: '002.jpg', mediaType: 'image/jpeg' },
      ];

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/api/v1/series?')) {
            return new Response(JSON.stringify(mockSeries), { status: 200 });
          }
          if (url.includes('/books?')) {
            return new Response(JSON.stringify(mockBooks), { status: 200 });
          }
          if (url.includes('/pages')) {
            return new Response(JSON.stringify(mockPages), { status: 200 });
          }
          return new Response(JSON.stringify({}), { status: 200 });
        }),
      );

      const src = new KomgaSource('komga-1', 'My Komga', 'http://localhost:25600');
      const page = await src.browse('latest');
      expect(page.items.length).toBe(1);
      expect(page.items[0].title).toBe('Berserk Deluxe');

      const chapters = await src.chapters('komga:komga-1:series-1');
      expect(chapters.length).toBe(1);
      expect(chapters[0].id).toBe('book-1');

      const pages = await src.pages('book-1');
      expect(pages.length).toBe(2);
      expect(pages[0].url).toBe('http://localhost:25600/api/v1/books/book-1/pages/1');
    });
  });

  describe('Sources Registry Integration', () => {
    it('returns all built-in sources in getAllBookSources()', async () => {
      const sources = await getAllBookSources();
      const ids = sources.map((s) => s.id);
      expect(ids).toContain('gutenberg');
      expect(ids).toContain('standardebooks');
      expect(ids).toContain('openlibrary');
      expect(ids).toContain('archiveorg');
      expect(ids).toContain('mangadex');
      expect(ids).toContain('mangapill');
    });

    it('returns manga sources in getAllMangaSources()', async () => {
      const sources = await getAllMangaSources();
      const ids = sources.map((s) => s.id);
      expect(ids).toContain('mangadex');
      expect(ids).toContain('mangapill');
    });

    it('resolves sources by ID and by item prefix', async () => {
      expect((await getSourceById('openlibrary'))?.name).toBe('Open Library');
      expect((await getSourceById('archiveorg'))?.name).toBe('Internet Archive');
      expect((await getSourceById('mangapill'))?.name).toBe('MangaPill');

      expect((await getSourceById('openlibrary:OL123W'))?.name).toBe('Open Library');
      expect((await getSourceById('archiveorg:pride01'))?.name).toBe('Internet Archive');
      expect((await getSourceById('mangapill:1:slug'))?.name).toBe('MangaPill');
    });

    it('adds and retrieves custom Suwayomi and Komga sources', async () => {
      const suwa = await addCustomSuwayomiSource({
        name: 'My Tachiyomi Server',
        url: 'http://192.168.1.50:4567',
        apiKey: 'token123',
      });
      expect(suwa.name).toBe('My Tachiyomi Server');

      const komga = await addCustomKomgaSource({
        name: 'Home Comics',
        url: 'http://192.168.1.50:25600',
        username: 'user',
        password: 'pwd',
      });
      expect(komga.name).toBe('Home Comics');

      const foundSuwa = await getSourceById(suwa.id);
      expect(foundSuwa).toBeDefined();
      expect(foundSuwa?.name).toBe('My Tachiyomi Server');

      const foundKomga = await getSourceById(komga.id);
      expect(foundKomga).toBeDefined();
      expect(foundKomga?.name).toBe('Home Comics');

      const allManga = await getAllMangaSources();
      expect(allManga.map((s) => s.id)).toContain(suwa.id);
      expect(allManga.map((s) => s.id)).toContain(komga.id);
    });
  });
});
