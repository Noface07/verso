import { net } from '../lib/net';
import type {
  CatalogEntry,
  CatalogPage,
  CatalogSection,
  ChapterInfo,
  MangaSource,
  PageRef,
} from './types';

interface KomgaSeriesItem {
  id: string;
  name: string;
  booksCount: number;
  metadata?: {
    status?: string;
    summary?: string;
    genres?: string[];
    tags?: string[];
  };
  booksMetadata?: {
    authors?: Array<{ name: string; role: string }>;
  };
}

interface KomgaSeriesPageResponse {
  content: KomgaSeriesItem[];
  empty: boolean;
  first: boolean;
  last: boolean;
  number: number;
  numberOfElements: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

interface KomgaBookItem {
  id: string;
  name: string;
  number: number;
  media: {
    status: string;
    mediaType: string;
    pagesCount: number;
  };
  metadata?: {
    title?: string;
    number?: string;
    numberSort?: number;
    summary?: string;
    releaseDate?: string;
    authors?: Array<{ name: string; role: string }>;
  };
}

interface KomgaBookPageResponse {
  content: KomgaBookItem[];
}

interface KomgaPageItem {
  number: number;
  fileName: string;
  mediaType: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export class KomgaSource implements MangaSource {
  id: string;
  name: string;
  icon = 'BookOpen';
  kind = 'manga' as const;
  baseUrl: string;
  authHeader?: string;

  constructor(
    id = 'komga',
    name = 'Komga Server',
    baseUrl = 'http://localhost:25600',
    credentials?: { username?: string; password?: string; apiKey?: string },
  ) {
    this.id = id;
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/+$/, '');

    if (credentials?.username || credentials?.password) {
      const u = credentials.username || '';
      const p = credentials.password || '';
      this.authHeader = `Basic ${btoa(`${u}:${p}`)}`;
    } else if (credentials?.apiKey) {
      this.authHeader = `Bearer ${credentials.apiKey}`;
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }
    return headers;
  }

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'latest', title: 'Recently Added' },
      { id: 'updated', title: 'Recently Updated' },
    ];
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const page = cursor ? parseInt(cursor, 10) : 0;
    const sort = sectionId === 'updated' ? 'lastModifiedDate,desc' : 'createdDate,desc';
    const url = `${this.baseUrl}/api/v1/series?page=${page}&size=24&sort=${sort}`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to load Komga series: ${res.statusText}`);
    }

    const data = (await res.json()) as KomgaSeriesPageResponse;
    const items: CatalogEntry[] = (data.content || []).map((s) => ({
      id: `komga:${this.id}:${s.id}`,
      title: s.name,
      authors: s.booksMetadata?.authors?.map((a) => a.name) || ['Komga Creator'],
      cover: `${this.baseUrl}/api/v1/series/${s.id}/thumbnail`,
      summary: s.metadata?.summary,
      tags: [...(s.metadata?.genres || []), ...(s.metadata?.tags || [])].slice(0, 5),
      kind: 'manga',
      status: s.metadata?.status?.toLowerCase(),
    }));

    return {
      items,
      next: !data.last ? String(page + 1) : undefined,
    };
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    const page = cursor ? parseInt(cursor, 10) : 0;
    const url = `${this.baseUrl}/api/v1/series?search=${encodeURIComponent(query.trim())}&page=${page}&size=24`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to search Komga: ${res.statusText}`);
    }

    const data = (await res.json()) as KomgaSeriesPageResponse;
    const items: CatalogEntry[] = (data.content || []).map((s) => ({
      id: `komga:${this.id}:${s.id}`,
      title: s.name,
      authors: s.booksMetadata?.authors?.map((a) => a.name) || ['Komga Creator'],
      cover: `${this.baseUrl}/api/v1/series/${s.id}/thumbnail`,
      summary: s.metadata?.summary,
      tags: [...(s.metadata?.genres || []), ...(s.metadata?.tags || [])].slice(0, 5),
      kind: 'manga',
      status: s.metadata?.status?.toLowerCase(),
    }));

    return {
      items,
      next: !data.last ? String(page + 1) : undefined,
    };
  }

  async details(id: string): Promise<CatalogEntry> {
    const parts = id.split(':');
    const seriesId = parts[parts.length - 1];
    const url = `${this.baseUrl}/api/v1/series/${seriesId}`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to fetch Komga series details: ${res.statusText}`);
    }

    const s = (await res.json()) as KomgaSeriesItem;
    return {
      id,
      title: s.name,
      authors: s.booksMetadata?.authors?.map((a) => a.name) || ['Komga Creator'],
      cover: `${this.baseUrl}/api/v1/series/${s.id}/thumbnail`,
      summary: s.metadata?.summary,
      tags: [...(s.metadata?.genres || []), ...(s.metadata?.tags || [])].slice(0, 6),
      kind: 'manga',
      status: s.metadata?.status?.toLowerCase(),
    };
  }

  async chapters(seriesId: string): Promise<ChapterInfo[]> {
    const parts = seriesId.split(':');
    const actualSeriesId = parts[parts.length - 1];
    const url = `${this.baseUrl}/api/v1/series/${actualSeriesId}/books?page=0&size=500&sort=metadata.numberSort,asc`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to load Komga books: ${res.statusText}`);
    }

    const data = (await res.json()) as KomgaBookPageResponse;
    return (data.content || []).map((b) => ({
      id: b.id,
      title: b.metadata?.title || b.name,
      number: b.metadata?.numberSort ?? b.number,
      scanlationGroup: 'Komga',
      publishedAt: b.metadata?.releaseDate,
    }));
  }

  async pages(chapterId: string): Promise<PageRef[]> {
    const url = `${this.baseUrl}/api/v1/books/${chapterId}/pages`;
    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to load Komga book pages: ${res.statusText}`);
    }

    const pages = (await res.json()) as KomgaPageItem[];
    return pages.map((p) => ({
      index: p.number,
      url: `${this.baseUrl}/api/v1/books/${chapterId}/pages/${p.number}`,
    }));
  }

  credit(chapter: ChapterInfo): string {
    return `Hosted on Komga Server · Issue: ${chapter.title || 'Chapter'}`;
  }
}
