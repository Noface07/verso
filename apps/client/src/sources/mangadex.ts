import { net } from '../lib/net';
import { getContentRatings } from '../lib/mangaPrefs';
import { cachedJson } from '../lib/apiCache';
import type {
  CatalogFilter,
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
  year?: number | null;
  publicationDemographic?: string | null;
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
    tags,
    kind: 'manga',
    status: item.attributes.status || undefined,
    contentRating: item.attributes.contentRating || undefined,
    year: item.attributes.year ?? undefined,
    demographic: item.attributes.publicationDemographic ?? undefined,
  };
}

function applyMangaDexFilters(params: URLSearchParams, filters?: Record<string, string>): void {
  if (filters?.rating === 'adult') {
    const adult = getContentRatings().filter((r) => r === 'erotica' || r === 'pornographic');
    // Only reachable when opted in; never widen beyond what Settings allows.
    if (adult.length) {
      params.delete('contentRating[]');
      for (const r of adult) params.append('contentRating[]', r);
    }
  }
  if (filters?.genre) params.append('includedTags[]', filters.genre);
  if (filters?.origin) params.append('originalLanguage[]', filters.origin);
  if (filters?.status) params.append('status[]', filters.status);
  if (filters?.demographic) params.append('publicationDemographic[]', filters.demographic);
}

export class MangaDexSource implements MangaSource {
  id = 'mangadex';
  name = 'MangaDex';
  icon = 'BookOpen';
  kind = 'manga' as const;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'popular', title: 'Popular' },
      { id: 'rating', title: 'Top Rated' },
      { id: 'latest', title: 'Latest Updates' },
      { id: 'recent', title: 'Recently Added' },
    ];
  }

  // Shown in the Store. The 18+ filter only exists once adult content has been
  // enabled in Settings (opt-in with age confirmation); otherwise it's not offered.
  get filters(): CatalogFilter[] {
    const adultOn = getContentRatings().some((r) => r === 'erotica' || r === 'pornographic');
    return adultOn
      ? [
          ...this.baseFilters,
          {
            id: 'rating',
            label: '18+',
            options: [
              { value: '', label: 'All ratings' },
              { value: 'adult', label: '18+ only', hint: 'Only erotica and pornographic titles.' },
            ],
          },
        ]
      : this.baseFilters;
  }

  private baseFilters: CatalogFilter[] = [
    {
      // Tag IDs from GET /manga/tag (stable UUIDs).
      id: 'genre',
      label: 'Genre',
      options: [
        { value: '', label: 'Any genre' },
        { value: '391b0423-d847-456f-aff0-8b0cfc03066b', label: 'Action' },
        { value: '87cc87cd-a395-47af-b27a-93258283bbc6', label: 'Adventure' },
        { value: '4d32cc48-9f00-4cca-9b5a-a839f0764984', label: 'Comedy' },
        { value: 'b9af3a63-f058-46de-a9a0-e0c13906197a', label: 'Drama' },
        { value: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc', label: 'Fantasy' },
        { value: '33771934-028e-4cb3-8744-691e866a923e', label: 'Historical' },
        { value: 'cdad7e68-1419-41dd-bdce-27753074a640', label: 'Horror' },
        { value: 'ace04997-f6bd-436e-b261-779182193d3d', label: 'Isekai' },
        { value: '799c202e-7daa-44eb-9cf7-8a3c0441531e', label: 'Martial Arts' },
        { value: '50880a9d-5440-4732-9afb-8f457127e836', label: 'Mecha' },
        { value: 'ee968100-4191-4968-93d3-f82d72be7e46', label: 'Mystery' },
        { value: '3b60b75c-a2d7-4860-ab56-05f391bb889c', label: 'Psychological' },
        { value: '423e2eae-a7a2-4a8b-ac03-a8351462d71d', label: 'Romance' },
        { value: 'caaa44eb-cd40-4177-b930-79d3ef2afe87', label: 'School Life' },
        { value: '256c8bd9-4904-4360-bf4f-508a76d67183', label: 'Sci-Fi' },
        { value: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9', label: 'Slice of Life' },
        { value: '69964a64-2f90-4d33-beeb-f3ed2875eb4c', label: 'Sports' },
        { value: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75', label: 'Supernatural' },
        { value: '07251805-a27e-4d59-b488-f0bfbec15168', label: 'Thriller' },
        { value: 'f8f62932-27da-4fe4-8ee1-6779a8c5edba', label: 'Tragedy' },
      ],
    },
    {
      id: 'origin',
      label: 'Type',
      options: [
        { value: '', label: 'All types' },
        { value: 'ja', label: 'Manga (Japanese)' },
        { value: 'ko', label: 'Manhwa (Korean)' },
        { value: 'zh', label: 'Manhua (Chinese)' },
      ],
    },
    {
      id: 'status',
      label: 'Status',
      options: [
        { value: '', label: 'Any status' },
        { value: 'ongoing', label: 'Ongoing' },
        { value: 'completed', label: 'Completed' },
        { value: 'hiatus', label: 'Hiatus' },
      ],
    },
    {
      id: 'demographic',
      label: 'Audience',
      options: [
        { value: '', label: 'Any audience' },
        { value: 'shounen', label: 'Shounen · teen boys', hint: 'Shounen: aimed at teenage boys. Action, rivalry, friendship (e.g. One Piece, Naruto).' },
        { value: 'shoujo', label: 'Shoujo · teen girls', hint: 'Shoujo: aimed at teenage girls. Romance, relationships, drama (e.g. Fruits Basket).' },
        { value: 'seinen', label: 'Seinen · adult men', hint: 'Seinen: aimed at adult men. Often darker or more mature themes (e.g. Berserk, Vagabond).' },
        { value: 'josei', label: 'Josei · adult women', hint: 'Josei: aimed at adult women. Realistic romance and everyday life (e.g. Nana).' },
      ],
    },
  ];

  async browse(sectionId: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
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
    applyMangaDexFilters(params, filters);

    if (sectionId === 'popular') {
      params.set('order[followedCount]', 'desc');
    } else if (sectionId === 'rating') {
      params.set('order[rating]', 'desc');
    } else if (sectionId === 'recent') {
      params.set('order[createdAt]', 'desc');
    } else {
      params.set('order[latestUploadedChapter]', 'desc');
    }

    const url = `https://api.mangadex.org/manga?${params.toString()}`;
    const json = await cachedJson<MangaDexListResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Failed to browse MangaDex: ${res.statusText}`);
        return (await res.json()) as MangaDexListResponse;
      },
      { freshMs: 30 * 60_000 },
    );
    const items = json.data.map(parseMangaDexItem);
    const hasMore = offset + limit < json.total;
    const next = hasMore ? String(offset + limit) : undefined;

    return { items, next };
  }

  async search(
    query: string,
    cursor?: string,
    filters?: Record<string, string>,
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

    applyMangaDexFilters(params, filters);
    if (query.trim()) {
      params.set('title', query.trim());
    }

    const url = `https://api.mangadex.org/manga?${params.toString()}`;
    const json = await cachedJson<MangaDexListResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Failed to search MangaDex: ${res.statusText}`);
        return (await res.json()) as MangaDexListResponse;
      },
      { freshMs: 30 * 60_000 },
    );
    const items = json.data.map(parseMangaDexItem);
    const hasMore = offset + limit < json.total;
    const next = hasMore ? String(offset + limit) : undefined;

    return { items, next };
  }

  async details(id: string): Promise<CatalogEntry> {
    const rawId = id.replace(/^mangadex:/, '');
    const url = `https://api.mangadex.org/manga/${rawId}?includes[]=cover_art&includes[]=author&includes[]=artist`;
    const json = await cachedJson<{ data: MangaDexMangaItem }>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch manga details: ${res.statusText}`);
        return (await res.json()) as { data: MangaDexMangaItem };
      },
      { freshMs: 6 * 60 * 60_000 },
    );
    return parseMangaDexItem(json.data);
  }

  async chapters(seriesId: string): Promise<ChapterInfo[]> {
    const rawId = seriesId.replace(/^mangadex:/, '');
    const items = await cachedJson<MangaDexChapterItem[]>(
      `mangadex:chapters:${rawId}`,
      () => this.fetchFeed(rawId, seriesId),
      { freshMs: 30 * 60_000 },
    );
    return this.buildChapterList(items);
  }

  private async fetchFeed(rawId: string, seriesId: string): Promise<MangaDexChapterItem[]> {
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
    return items;
  }

  private buildChapterList(items: MangaDexChapterItem[]): ChapterInfo[] {
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
   * Chapters published since `sinceMs` across followed series, newest first.
   * GET /chapter only accepts a single `manga` id, so each series' own feed is
   * queried, three at a time (the shared rate limiter keeps us under 4 req/s).
   */
  async recentChapters(
    seriesIds: string[],
    sinceMs: number,
  ): Promise<(ChapterInfo & { seriesId: string })[]> {
    // MangaDex wants "YYYY-MM-DDTHH:MM:SS" (no milliseconds or zone).
    const since = new Date(sinceMs).toISOString().slice(0, 19);
    const out: (ChapterInfo & { seriesId: string })[] = [];
    let failures = 0;
    const queue = [...seriesIds];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const params = new URLSearchParams();
        params.append('translatedLanguage[]', 'en');
        params.append('includes[]', 'scanlation_group');
        params.set('publishAtSince', since);
        params.set('order[publishAt]', 'desc');
        params.set('includeFuturePublishAt', '0');
        params.set('limit', '50');
        const rawId = id.replace(/^mangadex:/, '');
        try {
          const res = await net.fetch(`https://api.mangadex.org/manga/${rawId}/feed?${params.toString()}`);
          if (!res.ok) throw new Error(res.statusText);
          const json = (await res.json()) as MangaDexFeedResponse;
          for (const ch of json.data) {
            const externalUrl = ch.attributes.externalUrl || undefined;
            if (!externalUrl && !ch.attributes.pages) continue;
            const groupRel = ch.relationships.find((r) => r.type === 'scanlation_group');
            const label = ch.attributes.chapter ? `Ch. ${ch.attributes.chapter}` : 'Oneshot';
            out.push({
              id: ch.id,
              seriesId: `mangadex:${rawId}`,
              number: ch.attributes.chapter ? parseFloat(ch.attributes.chapter) : undefined,
              title: ch.attributes.title ? `${label} — ${ch.attributes.title}` : label,
              scanlationGroup: groupRel?.attributes?.name || 'No Group',
              publishedAt: ch.attributes.publishAt,
              externalUrl,
            });
          }
        } catch {
          failures++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (failures && failures === seriesIds.length) {
      throw new Error('MangaDex did not answer. Check your connection and try again.');
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
