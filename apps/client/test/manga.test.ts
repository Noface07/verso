import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MangaDexSource } from '../src/sources/mangadex';
import { db, dirty, now, uid, type Series, type ChapterProgress } from '../src/db';

describe('Phase 7: Manga, MangaDex & Reader', () => {
  beforeEach(async () => {
    await db.series.clear();
    await db.chapter_progress.clear();
    await db.manga_pages.clear();
    vi.restoreAllMocks();
  });

  describe('P7.2: MangaDex Source Plugin & Guardrails', () => {
    it('returns standard sections and formats credit lines per legal guardrails', async () => {
      const source = new MangaDexSource();
      const sections = await source.sections();
      expect(sections.map((s) => s.id)).toEqual(['popular', 'latest', 'recent']);

      const creditLine = source.credit({
        id: 'ch-1',
        title: 'Chapter 1',
        scanlationGroup: 'Flame Scans',
      });
      expect(creditLine).toBe('Scanlation: Flame Scans · Hosted on MangaDex');
    });

    it('correctly transforms MangaDex manga list response into CatalogEntry', async () => {
      const mockMangaResponse = {
        result: 'ok',
        response: 'collection',
        data: [
          {
            id: 'manga-abc-123',
            type: 'manga',
            attributes: {
              title: { en: 'Frieren: Beyond Journey\'s End' },
              description: { en: 'The adventure is over but life goes on.' },
              status: 'ongoing',
              contentRating: 'safe',
              tags: [
                {
                  id: 'tag-1',
                  attributes: { name: { en: 'Fantasy' } },
                },
                {
                  id: 'tag-2',
                  attributes: { name: { en: 'Adventure' } },
                },
              ],
            },
            relationships: [
              {
                id: 'author-1',
                type: 'author',
                attributes: { name: 'Yamada Kanehito' },
              },
              {
                id: 'cover-1',
                type: 'cover_art',
                attributes: { fileName: 'frieren_cover.jpg' },
              },
            ],
          },
        ],
        limit: 24,
        offset: 0,
        total: 1,
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockMangaResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const source = new MangaDexSource();
      const page = await source.browse('popular');

      expect(page.items.length).toBe(1);
      const manga = page.items[0];
      expect(manga.id).toBe('mangadex:manga-abc-123');
      expect(manga.title).toBe('Frieren: Beyond Journey\'s End');
      expect(manga.authors).toEqual(['Yamada Kanehito']);
      expect(manga.cover).toBe(
        'https://uploads.mangadex.org/covers/manga-abc-123/frieren_cover.jpg.256.jpg',
      );
      expect(manga.tags).toEqual(['Fantasy', 'Adventure']);
      expect(manga.kind).toBe('manga');
    });

    it('de-duplicates chapter feed by chapter number, preferring most recent upload', async () => {
      const mockFeedResponse = {
        result: 'ok',
        response: 'collection',
        data: [
          {
            id: 'ch-1-older',
            type: 'chapter',
            attributes: {
              volume: '1',
              chapter: '1',
              title: 'The End of the Beginning',
              publishAt: '2023-01-01T00:00:00Z',
              externalUrl: null,
              pages: 30,
            },
            relationships: [
              {
                id: 'group-1',
                type: 'scanlation_group',
                attributes: { name: 'Early Group' },
              },
            ],
          },
          {
            id: 'ch-1-newer',
            type: 'chapter',
            attributes: {
              volume: '1',
              chapter: '1',
              title: 'The End of the Beginning (HQ)',
              publishAt: '2023-05-01T00:00:00Z',
              externalUrl: null,
              pages: 30,
            },
            relationships: [
              {
                id: 'group-2',
                type: 'scanlation_group',
                attributes: { name: 'HQ Scans' },
              },
            ],
          },
          {
            id: 'ch-2',
            type: 'chapter',
            attributes: {
              volume: '1',
              chapter: '2',
              title: 'Priest\'s Lie',
              publishAt: '2023-02-01T00:00:00Z',
              externalUrl: null,
              pages: 25,
            },
            relationships: [
              {
                id: 'group-2',
                type: 'scanlation_group',
                attributes: { name: 'HQ Scans' },
              },
            ],
          },
        ],
        limit: 500,
        offset: 0,
        total: 3,
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(mockFeedResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const source = new MangaDexSource();
      const chapters = await source.chapters('mangadex:manga-1');

      // 3 chapters in feed, but chapter 1 is duplicated -> should produce 2 chapters
      expect(chapters.length).toBe(2);
      expect(chapters[0].number).toBe(1);
      expect(chapters[0].id).toBe('ch-1-newer'); // Selected HQ Scans newer version
      expect(chapters[0].scanlationGroup).toBe('HQ Scans');
      expect(chapters[1].number).toBe(2);
    });

    it('resolves page URLs via at-home server endpoint', async () => {
      const mockAtHomeResponse = {
        result: 'ok',
        baseUrl: 'https://s2.mangadex.network',
        chapter: {
          hash: 'abc123hash',
          data: ['1-page.png', '2-page.png'],
          dataSaver: ['1-page.jpg', '2-page.jpg'],
        },
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () =>
          new Response(JSON.stringify(mockAtHomeResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const source = new MangaDexSource();
      const normalPages = await source.pages('ch-1', false);
      expect(normalPages.length).toBe(2);
      expect(normalPages[0].url).toBe(
        'https://s2.mangadex.network/data/abc123hash/1-page.png',
      );

      const dataSaverPages = await source.pages('ch-1', true);
      expect(dataSaverPages.length).toBe(2);
      expect(dataSaverPages[0].url).toBe(
        'https://s2.mangadex.network/data-saver/abc123hash/1-page.jpg',
      );
    });
  });

  describe('P7.5: Offline Page Storage (db.manga_pages)', () => {
    it('stores and retrieves downloaded page blobs and cleans up properly', async () => {
      const seriesId = 'mangadex:series-1';
      const chapterId = 'ch-42';

      const blob1 = new Blob(['page 1 image bytes'], { type: 'image/jpeg' });
      const blob2 = new Blob(['page 2 image bytes'], { type: 'image/jpeg' });

      await db.manga_pages.put({
        id: `${seriesId}:${chapterId}:1`,
        series_id: seriesId,
        chapter_id: chapterId,
        page: 1,
        blob: blob1,
        created_at: Date.now(),
      });

      await db.manga_pages.put({
        id: `${seriesId}:${chapterId}:2`,
        series_id: seriesId,
        chapter_id: chapterId,
        page: 2,
        blob: blob2,
        created_at: Date.now(),
      });

      // Retrieve cached pages for chapter
      const pages = await db.manga_pages
        .where('[series_id+chapter_id]')
        .equals([seriesId, chapterId])
        .toArray();

      expect(pages.length).toBe(2);
      expect(pages[0].page).toBe(1);
      expect(pages[1].page).toBe(2);

      // Clean up chapter pages
      for (const p of pages) {
        await db.manga_pages.delete(p.id);
      }

      const remaining = await db.manga_pages
        .where('[series_id+chapter_id]')
        .equals([seriesId, chapterId])
        .toArray();
      expect(remaining.length).toBe(0);
    });
  });

  describe('P7.6: Series Follow & Chapter Progress Tracking', () => {
    it('persists followed series and tracks chapter progress', async () => {
      const seriesId = 'mangadex:series-test';
      const series: Series = {
        id: seriesId,
        source: 'mangadex',
        source_id: 'series-test',
        title: 'Chainsaw Man',
        author: 'Tatsuki Fujimoto',
        cover_url: 'https://example.com/csm.jpg',
        meta: {},
        added_at: now(),
        last_read_at: null,
        last_checked_at: now(),
        deleted_at: null,
        ...dirty(),
      };

      await db.series.put(series);
      const storedSeries = await db.series.get(seriesId);
      expect(storedSeries).toBeDefined();
      expect(storedSeries?.title).toBe('Chainsaw Man');

      // Update progress on Chapter 1
      const progress: ChapterProgress = {
        id: uid(),
        series_id: seriesId,
        source: 'mangadex',
        chapter_id: 'ch-1',
        chapter_number: 1,
        title: 'Dog & Chainsaw',
        page: 24,
        total_pages: 24,
        read: true,
        read_at: now(),
        deleted_at: null,
        ...dirty(),
      };

      await db.chapter_progress.put(progress);

      const storedProgress = await db.chapter_progress
        .filter((p) => p.series_id === seriesId && p.chapter_id === 'ch-1')
        .first();

      expect(storedProgress).toBeDefined();
      expect(storedProgress?.read).toBe(true);
      expect(storedProgress?.page).toBe(24);
    });
  });
});
