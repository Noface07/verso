import { net } from '../lib/net';
import { cachedJson } from '../lib/apiCache';
import type {
  CatalogEntry,
  CatalogPage,
  CatalogSection,
  ChapterInfo,
  MangaSource,
  PageRef,
} from './types';

function parseMangaPillCards(html: string): CatalogEntry[] {
  const items: CatalogEntry[] = [];
  const cardRegex = /<a\s+href="\/manga\/(\d+)\/([^"]+)"[^>]*>[\s\S]*?<img\s+(?:data-src|src)="([^"]+)"[^>]*>[\s\S]*?<div[^>]*>([^<]+)<\/div>/g;
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(html)) !== null) {
    const id = match[1];
    const slug = match[2];
    const cover = match[3];
    const title = match[4].replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();

    items.push({
      id: `mangapill:${id}:${slug}`,
      title,
      authors: ['Manga Artist'],
      cover,
      kind: 'manga',
    });
  }

  // Fallback pattern if card layout differs slightly
  if (items.length === 0) {
    const fallbackRegex = /<a\s+href="\/manga\/(\d+)\/([^"]+)"/g;
    const seen = new Set<string>();
    while ((match = fallbackRegex.exec(html)) !== null) {
      const id = match[1];
      const slug = match[2];
      const key = `${id}:${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      items.push({
        id: `mangapill:${key}`,
        title,
        authors: ['Manga Artist'],
        kind: 'manga',
      });
    }
  }

  return items;
}

export class MangaPillSource implements MangaSource {
  id = 'mangapill';
  name = 'MangaPill';
  icon = 'BookOpen';
  kind = 'manga' as const;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'popular', title: 'Popular' },
      { id: 'new', title: 'New Manga' },
      { id: 'recent', title: 'Latest Updates' },
    ];
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const page = cursor ? parseInt(cursor, 10) : 1;
    let url = 'https://mangapill.com/search?q=&type=&status=&sort=popularity';

    if (sectionId === 'new') {
      url = `https://mangapill.com/mangas/new?page=${page}`;
    } else if (sectionId === 'recent') {
      url = `https://mangapill.com/chapters?page=${page}`;
    } else {
      url = `https://mangapill.com/search?q=&type=&status=&sort=popularity&page=${page}`;
    }

    const html = await cachedJson<string>(
      url,
      async () => {
        const res = await net.fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!res.ok) throw new Error(`MangaPill browse error: ${res.statusText}`);
        return res.text();
      },
      { freshMs: 30 * 60_000 },
    );

    const items = parseMangaPillCards(html);
    const hasMore = items.length >= 10;
    const next = hasMore ? String(page + 1) : undefined;

    return { items, next };
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `https://mangapill.com/search?q=${encodeURIComponent(query.trim())}&page=${page}`;

    const html = await cachedJson<string>(
      url,
      async () => {
        const res = await net.fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!res.ok) throw new Error(`MangaPill search error: ${res.statusText}`);
        return res.text();
      },
      { freshMs: 30 * 60_000 },
    );

    const items = parseMangaPillCards(html);
    const hasMore = items.length >= 10;
    const next = hasMore ? String(page + 1) : undefined;

    return { items, next };
  }

  async details(id: string): Promise<CatalogEntry> {
    const parts = id.replace(/^mangapill:/, '').split(':');
    const mangaId = parts[0];
    const slug = parts[1] || '';
    const url = `https://mangapill.com/manga/${mangaId}/${slug}`;

    const html = await cachedJson<string>(
      url,
      async () => {
        const res = await net.fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!res.ok) throw new Error(`MangaPill details error: ${res.statusText}`);
        return res.text();
      },
      { freshMs: 6 * 60 * 60_000 },
    );

    // Title
    const titleMatch = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
    const title = titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' ');

    // Cover
    const coverMatch = /<div class="[^"]*flex[^"]*">[\s\S]*?<img\s+(?:data-src|src)="([^"]+)"/i.exec(html);
    const cover = coverMatch ? coverMatch[1] : undefined;

    // Synopsis
    const descMatch = /<p[^>]*class="[^"]*text-sm[^"]*text-secondary[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html) ||
                      /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    const summary = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Tags/Genres
    const tags: string[] = [];
    const genreRegex = /<a\s+href="\/search\?genre=[^"]*"[^>]*>([^<]+)<\/a>/g;
    let gm: RegExpExecArray | null;
    while ((gm = genreRegex.exec(html)) !== null) {
      tags.push(gm[1].trim());
    }

    // Status
    const statusMatch = /Status[\s\S]*?<div[^>]*>([^<]+)<\/div>/i.exec(html);
    const status = statusMatch ? statusMatch[1].trim().toLowerCase() : undefined;

    return {
      id,
      title,
      authors: ['Manga Creator'],
      cover,
      summary,
      tags: tags.slice(0, 6),
      kind: 'manga',
      status,
    };
  }

  async chapters(seriesId: string): Promise<ChapterInfo[]> {
    const parts = seriesId.replace(/^mangapill:/, '').split(':');
    const mangaId = parts[0];
    const slug = parts[1] || '';
    const url = `https://mangapill.com/manga/${mangaId}/${slug}`;

    const html = await cachedJson<string>(
      `mangapill:chapters:${mangaId}`,
      async () => {
        const res = await net.fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!res.ok) throw new Error(`MangaPill chapters error: ${res.statusText}`);
        return res.text();
      },
      { freshMs: 30 * 60_000 },
    );

    const chapters: ChapterInfo[] = [];
    const chapterRegex = /<a\s+href="\/chapters\/(\d+-\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;

    while ((match = chapterRegex.exec(html)) !== null) {
      const chId = match[1];
      const chTitle = match[2].replace(/<[^>]+>/g, '').trim();
      const numMatch = /Chapter\s+(\d+(?:\.\d+)?)/i.exec(chTitle);
      const num = numMatch ? parseFloat(numMatch[1]) : undefined;

      chapters.push({
        id: chId,
        title: chTitle,
        number: num,
        scanlationGroup: 'MangaPill',
      });
    }

    return chapters;
  }

  async pages(chapterId: string): Promise<PageRef[]> {
    const url = `https://mangapill.com/chapters/${chapterId}`;
    const res = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to load MangaPill chapter pages: ${res.statusText}`);
    }

    const html = await res.text();
    const pages: PageRef[] = [];
    const imgRegex = /data-src="([^"]+)"/g;
    let match: RegExpExecArray | null;
    let idx = 1;

    while ((match = imgRegex.exec(html)) !== null) {
      const imgUrl = match[1];
      if (imgUrl.includes('.jpeg') || imgUrl.includes('.jpg') || imgUrl.includes('.png') || imgUrl.includes('.webp')) {
        pages.push({
          index: idx++,
          url: imgUrl,
        });
      }
    }

    return pages;
  }

  credit(chapter: ChapterInfo): string {
    return `Scanlation: ${chapter.scanlationGroup || 'MangaPill'} · Hosted on MangaPill`;
  }
}

export const mangaPillSource = new MangaPillSource();
