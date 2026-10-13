import { net } from '../lib/net';
import { getContentRatings } from '../lib/mangaPrefs';
import type {
  CatalogEntry,
  CatalogPage,
  CatalogSection,
  ChapterInfo,
  MangaSource,
  PageRef,
} from './types';

interface MangaDexRelationship {
  id: string;
  type: string;
  attributes?: {
    fileName?: string;
    name?: string;
  };
}

interface MangaDexMangaAttributes {
  title: Record<string, string>;
  description: Record<string, string>;
  status: string;
  contentRating: string;
  tags: Array<{
    id: string;
    attributes: {
      name: Record<string, string>;
    };
  }>;
}

interface MangaDexMangaItem {
  id: string;
  type: string;
  attributes: MangaDexMangaAttributes;
  relationships: MangaDexRelationship[];
}

interface MangaDexListResponse {
  result: string;
  response: string;
  data: MangaDexMangaItem[];
  limit: number;
  offset: number;
  total: number;
}

interface MangaDexChapterItem {
  id: string;
  type: string;
  attributes: {
    volume: string | null;
    chapter: string | null;
    title: string | null;
    publishAt: string;
    externalUrl: string | null;
    pages: number;
  };
  relationships: MangaDexRelationship[];
}

interface MangaDexFeedResponse {
  result: string;
  response: string;
  data: MangaDexChapterItem[];
  limit: number;
  offset: number;
  total: number;
}

interface MangaDexAtHomeResponse {
  result: string;
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
  };
}

function parseMangaDexItem(item: MangaDexMangaItem): CatalogEntry {
  const title =
    item.attributes.title.en ||
    Object.values(item.attributes.title)[0] ||
    'Untitled Manga';

  const authorRel = item.relationships.find((r) => r.type === 'author' || r.type === 'artist');
  const authors = authorRel?.attributes?.name ? [authorRel.attributes.name] : ['MangaDex Creator'];

  const coverRel = item.relationships.find((r) => r.type === 'cover_art');
  const coverFileName = coverRel?.attributes?.fileName;
  const coverUrl = coverFileName
    ? `https://uploads.mangadex.org/covers/${item.id}/${coverFileName}.256.jpg`
    : undefined;

  const summary =
    item.attributes.description.en ||
    Object.values(item.attributes.description)[0] ||
    '';

  const tags = item.attributes.tags
    .map((t) => t.attributes.name.en || Object.values(t.attributes.name)[0])
    .filter(Boolean);

  return {
    id: `mangadex:${item.id}`,
    title,
    authors,
    cover: coverUrl,
    summary,
    tags: tags.slice(0, 8),
    kind: 'manga',
  };
}

export class MangaDexSource implements MangaSource {
  id = 'mangadex';
  name = 'MangaDex';
  icon = 'BookOpen';
  kind = 'manga' as const;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'popular', title: 'Popular' },
      { id: 'latest', title: 'Latest Updates' },
      { id: 'recent', title: 'Recently Added' },
    ];
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const limit = 24;
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const params = new URLSearchParams();

    params.set('limit', String(limit));
    params.set('offset', String(offset));
    params.append('includes[]', 'cover_art');
    params.append('includes[]', 'author');
    params.append('includes[]', 'artist');
    for (const rating of getContentRatings()) params.append('contentRating[]', rating);
    params.append('availableTranslatedLanguage[]', 'en');

    if (sectionId === 'popular') {
      params.set('order[followedCount]', 'desc');
    } else if (sectionId === 'recent') {
      params.set('order[createdAt]', 'desc');
    } else {
      params.set('order[latestUploadedChapter]', 'desc');
    }

    const url = `https://api.mangadex.org/manga?${params.toString()}`;
    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to browse MangaDex: ${res.statusText}`);
    }

    const json = (await res.json()) as MangaDexListResponse;
    const items = json.data.map(parseMangaDexItem);
    const hasMore = offset + limit < json.total;
    const next = hasMore ? String(offset + limit) : undefined;

    return { items, next };
  }

  async search(
    query: string,
    cursor?: string,
    _filters?: Record<string, string>,
  ): Promise<CatalogPage> {
    const limit = 24;
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const params = new URLSearchParams();

    params.set('limit', String(limit));
    params.set('offset', String(offset));
    params.append('includes[]', 'cover_art');
    params.append('includes[]', 'author');
    for (const rating of getContentRatings()) params.append('contentRating[]', rating);
    params.append('availableTranslatedLanguage[]', 'en');

    if (query.trim()) {
      params.set('title', query.trim());
    }

    const url = `https://api.mangadex.org/manga?${params.toString()}`;
    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to search MangaDex: ${res.statusText}`);
    }

    const json = (await res.json()) as MangaDexListResponse;
    const items = json.data.map(parseMangaDexItem);
    const hasMore = offset + limit < json.total;
    const next = hasMore ? String(offset + limit) : undefined;

    return { items, next };
  }

  async details(id: string): Promise<CatalogEntry> {
    const rawId = id.replace(/^mangadex:/, '');
    const url = `https://api.mangadex.org/manga/${rawId}?includes[]=cover_art&includes[]=author&includes[]=artist`;
    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch manga details: ${res.statusText}`);
    }

    const json = (await res.json()) as { data: MangaDexMangaItem };
    return parseMangaDexItem(json.data);
  }

  async chapters(seriesId: string): Promise<ChapterInfo[]> {
    const rawId = seriesId.replace(/^mangadex:/, '');
    const PAGE = 500;
    const items: MangaDexChapterItem[] = [];
    // The feed is paginated; long series (Berserk, One Piece) have far more than one page.
    for (let offset = 0; ; offset += PAGE) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE));
      params.set('offset', String(offset));
      params.append('translatedLanguage[]', 'en');
      params.append('includes[]', 'scanlation_group');
      params.set('order[chapter]', 'asc');
      params.set('includeFuturePublishAt', '0');
      const res = await net.fetch(`https://api.mangadex.org/manga/${rawId}/feed?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch chapters for ${seriesId}: ${res.statusText}`);
      }
      const json = (await res.json()) as MangaDexFeedResponse;
      items.push(...json.data);
      if (json.data.length < PAGE || offset + PAGE >= json.total) break;
    }

    const rawChapters: ChapterInfo[] = [];
    for (const ch of items) {
      const externalUrl = ch.attributes.externalUrl || undefined;
      // Hosted chapters with no pages can't be read anywhere; skip them.
      if (!externalUrl && !ch.attributes.pages) continue;
      const groupRel = ch.relationships.find((r) => r.type === 'scanlation_group');
      const scanlationGroup = groupRel?.attributes?.name || 'No Group';
      const num = ch.attributes.chapter ? parseFloat(ch.attributes.chapter) : undefined;
      const chapterLabel = ch.attributes.chapter ? `Ch. ${ch.attributes.chapter}` : 'Oneshot';
      const title = ch.attributes.title
        ? `${chapterLabel} — ${ch.attributes.title}`
        : chapterLabel;

      rawChapters.push({
        id: ch.id,
        number: num,
        title,
        scanlationGroup,
        publishedAt: ch.attributes.publishAt,
        externalUrl,
      });
    }

    // De-duplicate by chapter number. A version readable in the app always beats an
    // official external link (previously the newest won, which was often the
    // external one, so tapping the chapter left the app); then prefer the newest.
    const better = (a: ChapterInfo, b: ChapterInfo) => {
      if (!a.externalUrl !== !b.externalUrl) return !a.externalUrl;
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return ta > tb;
    };
    const byNumber = new Map<number, ChapterInfo>();
    const withoutNumber: ChapterInfo[] = [];

    for (const c of rawChapters) {
      if (c.number !== undefined && !isNaN(c.number)) {
        const existing = byNumber.get(c.number);
        if (!existing || better(c, existing)) byNumber.set(c.number, c);
      } else {
        withoutNumber.push(c);
      }
    }

    const sortedDeduped = Array.from(byNumber.values()).sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0),
    );

    return [...sortedDeduped, ...withoutNumber];
  }

  /**
   * Chapters published since `sinceMs` across many followed series, newest first.
   * Batched (100 series per request) so checking a whole follow list stays well
   * inside MangaDex's rate limits.
   */
  async recentChapters(
    seriesIds: string[],
    sinceMs: number,
  ): Promise<(ChapterInfo & { seriesId: string })[]> {
    const rawIds = seriesIds.map((id) => id.replace(/^mangadex:/, ''));
    // MangaDex wants "YYYY-MM-DDTHH:MM:SS" (no milliseconds or zone).
    const since = new Date(sinceMs).toISOString().slice(0, 19);
    const out: (ChapterInfo & { seriesId: string })[] = [];
    for (let i = 0; i < rawIds.length; i += 100) {
      const params = new URLSearchParams();
      for (const id of rawIds.slice(i, i + 100)) params.append('manga[]', id);
      params.append('translatedLanguage[]', 'en');
      params.append('includes[]', 'scanlation_group');
      params.set('publishAtSince', since);
      params.set('order[publishAt]', 'desc');
      params.set('includeFuturePublishAt', '0');
      params.set('limit', '100');
      const res = await net.fetch(`https://api.mangadex.org/chapter?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to check for new chapters: ${res.statusText}`);
      const json = (await res.json()) as MangaDexFeedResponse;
      for (const ch of json.data) {
        const externalUrl = ch.attributes.externalUrl || undefined;
        if (!externalUrl && !ch.attributes.pages) continue;
        const mangaRel = ch.relationships.find((r) => r.type === 'manga');
        if (!mangaRel) continue;
        const groupRel = ch.relationships.find((r) => r.type === 'scanlation_group');
        const label = ch.attributes.chapter ? `Ch. ${ch.attributes.chapter}` : 'Oneshot';
        out.push({
          id: ch.id,
          seriesId: `mangadex:${mangaRel.id}`,
          number: ch.attributes.chapter ? parseFloat(ch.attributes.chapter) : undefined,
          title: ch.attributes.title ? `${label} — ${ch.attributes.title}` : label,
          scanlationGroup: groupRel?.attributes?.name || 'No Group',
          publishedAt: ch.attributes.publishAt,
          externalUrl,
        });
      }
    }
    return out.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  }

  async pages(chapterId: string, dataSaver = false): Promise<PageRef[]> {
    const url = `https://api.mangadex.org/at-home/server/${chapterId}`;
    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch pages for chapter ${chapterId}: ${res.statusText}`);
    }

    const json = (await res.json()) as MangaDexAtHomeResponse;
    const baseUrl = json.baseUrl;
    const hash = json.chapter.hash;
    const files = dataSaver && json.chapter.dataSaver.length > 0
      ? json.chapter.dataSaver
      : json.chapter.data;
    const subpath = dataSaver && json.chapter.dataSaver.length > 0 ? 'data-saver' : 'data';

    return files.map((file, idx) => ({
      index: idx + 1,
      url: `${baseUrl}/${subpath}/${hash}/${file}`,
    }));
  }

  credit(chapter: ChapterInfo): string {
    const group = chapter.scanlationGroup || 'No Group';
    return `Scanlation: ${group} · Hosted on MangaDex`;
  }
}

export const mangaDexSource = new MangaDexSource();
