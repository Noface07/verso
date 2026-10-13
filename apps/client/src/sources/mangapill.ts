import { net, proxyImageUrl } from '../lib/net';
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
  const seen = new Set<string>();

  // Matches <a ... href="/manga/(\d+)/([^"/]+)" ...>
  const linkRegex = /<a\b[^>]*\bhref="\/manga\/(\d+)\/([^"/]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const id = match[1];
    const slug = match[2];
    if (seen.has(id)) continue;

    const inner = match[3];
    const imgMatch = /(?:data-src|src)="([^"]+)"/i.exec(inner);
    const titleMatch = /<div[^>]*>([^<]+)<\/div>/i.exec(inner);

    const title = (titleMatch?.[1] || '')
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .trim() || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const rawCover = imgMatch?.[1] || `https://cdn.readdetectiveconan.com/file/mangapill/i/${id}.jpeg`;

    seen.add(id);
    items.push({
      id: `mangapill:${id}:${slug}`,
      title,
      authors: ['Manga Artist'],
      cover: proxyImageUrl(rawCover),
      kind: 'manga',
    });
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
    let url = `https://mangapill.com/search?type=manga&sort=popularity&page=${page}`;

    if (sectionId === 'new') {
      url = `https://mangapill.com/mangas/new?page=${page}`;
    } else if (sectionId === 'recent') {
      url = `https://mangapill.com/chapters?page=${page}`;
    }

    const html = await cachedJson<string>(
      url,
      async () => {
        const res = await net.fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    const trimmed = query.trim();
    const url = page === 1 && trimmed.length < 20
      ? `https://mangapill.com/quick-search?q=${encodeURIComponent(trimmed)}`
      : `https://mangapill.com/search?q=${encodeURIComponent(trimmed)}&page=${page}`;

    const html = await cachedJson<string>(
      url,
      async () => {
        const res = await net.fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (!res.ok) throw new Error(`MangaPill details error: ${res.statusText}`);
        return res.text();
      },
      { freshMs: 6 * 60 * 60_000 },
    );

    // Title
    const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : slug.replace(/-/g, ' ');

    // Cover
    const coverMatch = /<img\b[^>]*\b(?:data-src|src)="([^"]+)"[^>]*\balt="[^"]*"/i.exec(html) ||
                       /(?:data-src|src)="([^"]*\/mangapill\/i\/[^"]+)"/i.exec(html);
    const rawCover = coverMatch ? coverMatch[1] : `https://cdn.readdetectiveconan.com/file/mangapill/i/${mangaId}.jpeg`;

    // Synopsis
    const descMatch = /<p[^>]*class="[^"]*text-sm[^"]*text-secondary[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html) ||
                      /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    const summary = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Tags/Genres
    const tags: string[] = [];
    const genreRegex = /<a\b[^>]*\bhref="\/search\?genre=[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let gm: RegExpExecArray | null;
    while ((gm = genreRegex.exec(html)) !== null) {
      tags.push(gm[1].replace(/<[^>]+>/g, '').trim());
    }

    // Status
    const statusMatch = /Status[\s\S]*?<div[^>]*>([^<]+)<\/div>/i.exec(html);
    const status = statusMatch ? statusMatch[1].trim().toLowerCase() : undefined;

    return {
      id,
      title,
      authors: ['Manga Creator'],
      cover: proxyImageUrl(rawCover),
      summary,
      tags: tags.slice(0, 8),
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (!res.ok) throw new Error(`MangaPill chapters error: ${res.statusText}`);
        return res.text();
      },
      { freshMs: 30 * 60_000 },
    );

    const chapters: ChapterInfo[] = [];
    const chapterRegex = /<a\b[^>]*\bhref="\/chapters\/(\d+-\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to load MangaPill chapter pages: ${res.statusText}`);
    }

    const html = await res.text();
    const pages: PageRef[] = [];
    const imgRegex = /(?:data-src|src)="([^"]+)"/gi;
    let match: RegExpExecArray | null;
    let idx = 1;
    const seen = new Set<string>();

    while ((match = imgRegex.exec(html)) !== null) {
      const imgUrl = match[1];
      if (
        (imgUrl.includes('.jpeg') || imgUrl.includes('.jpg') || imgUrl.includes('.png') || imgUrl.includes('.webp')) &&
        !imgUrl.includes('logo') && !imgUrl.includes('icon') && !imgUrl.includes('avatar') &&
        !seen.has(imgUrl)
      ) {
        seen.add(imgUrl);
        pages.push({
          index: idx++,
          url: proxyImageUrl(imgUrl) || imgUrl,
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
