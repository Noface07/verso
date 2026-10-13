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

export interface SuwayomiExtension {
  name: string;
  pkgName: string;
  versionName: string;
  versionCode?: number;
  lang: string;
  isNsfw: boolean;
  installed: boolean;
  hasUpdate: boolean;
  iconUrl?: string;
}

interface SuwayomiSourceInfo {
  id: string;
  name: string;
  lang: string;
  iconUrl?: string;
  supportsLatest?: boolean;
}

interface SuwayomiMangaItem {
  id: number;
  sourceId: string;
  title: string;
  thumbnailUrl?: string;
  artist?: string;
  author?: string;
  description?: string;
  genre?: string[];
  status?: string;
  inLibrary?: boolean;
}

interface SuwayomiMangaListResponse {
  mangaList: SuwayomiMangaItem[];
  hasNextPage: boolean;
}

interface SuwayomiChapterItem {
  id: number;
  name: string;
  chapterNumber?: number;
  uploadDate?: number;
  scanlator?: string;
  pageCount?: number;
}

export class SuwayomiSource implements MangaSource {
  id: string;
  name: string;
  icon = 'BookOpen';
  kind = 'manga' as const;
  baseUrl: string;
  apiKey?: string;

  constructor(
    id = 'suwayomi',
    name = 'Suwayomi (Tachiyomi)',
    baseUrl = 'http://localhost:4567',
    apiKey?: string,
  ) {
    this.id = id;
    this.name = name;
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private resolveUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  async getInstalledExtensions(): Promise<SuwayomiSourceInfo[]> {
    const url = `${this.baseUrl}/api/v1/source/list`;
    return cachedJson<SuwayomiSourceInfo[]>(
      `suwayomi:${this.id}:extensions`,
      async () => {
        try {
          const res = await net.fetch(url, { headers: this.getHeaders() });
          if (!res.ok) return [];
          const list = (await res.json()) as SuwayomiSourceInfo[];
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      },
      { freshMs: 10 * 60_000 },
    );
  }

  /** Fetch all extensions in the Suwayomi extension store (Keiyoushi repo) */
  async getExtensionList(): Promise<SuwayomiExtension[]> {
    const url = `${this.baseUrl}/api/v1/extension/list`;
    try {
      const res = await net.fetch(url, { headers: this.getHeaders() });
      if (!res.ok) return [];
      const list = (await res.json()) as SuwayomiExtension[];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Install an extension from the Suwayomi extension store */
  async installExtension(pkgName: string): Promise<boolean> {
    const url = `${this.baseUrl}/api/graphql`;
    try {
      const res = await net.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          query: `
            mutation InstallExt($id: ID!) {
              updateExtension(input: { id: $id, patch: { install: true } }) {
                clientMutationId
              }
            }
          `,
          variables: { id: pkgName },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Uninstall an extension */
  async uninstallExtension(pkgName: string): Promise<boolean> {
    const url = `${this.baseUrl}/api/graphql`;
    try {
      const res = await net.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          query: `
            mutation UninstallExt($id: ID!) {
              updateExtension(input: { id: $id, patch: { uninstall: true } }) {
                clientMutationId
              }
            }
          `,
          variables: { id: pkgName },
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sections(): Promise<CatalogSection[]> {
    const extensions = await this.getInstalledExtensions();
    if (extensions.length === 0) {
      return [
        { id: 'all', title: 'Tachiyomi Extensions' },
      ];
    }

    // Sort: put real remote extensions first (id !== '0'), and Local source last
    const realSources = extensions.filter((ext) => ext.id !== '0');
    const localSources = extensions.filter((ext) => ext.id === '0');
    const sorted = [...realSources, ...localSources];

    return sorted.map((ext) => ({
      id: ext.id,
      title:
        ext.id === '0'
          ? 'Local source (on-disk)'
          : `${ext.name} (${ext.lang.toUpperCase()})`,
    }));
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const extensions = await this.getInstalledExtensions();
    const realSources = extensions.filter((ext) => ext.id !== '0');
    const defaultSourceId = realSources.length > 0 ? realSources[0].id : extensions[0]?.id || '';
    const sourceId =
      sectionId && sectionId !== 'all'
        ? sectionId
        : defaultSourceId;

    if (!sourceId) {
      return {
        items: [],
        next: undefined,
      };
    }

    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `${this.baseUrl}/api/v1/source/${sourceId}/popular/${page}`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to load Suwayomi source: ${res.statusText}`);
    }

    const data = (await res.json()) as SuwayomiMangaListResponse;
    const items: CatalogEntry[] = (data.mangaList || []).map((m) => {
      const coverUrl = m.thumbnailUrl ? this.resolveUrl(m.thumbnailUrl) : undefined;
      const authors = m.author ? [m.author] : m.artist ? [m.artist] : ['Tachiyomi Creator'];

      return {
        id: `suwayomi:${this.id}:${sourceId}:${m.id}`,
        title: m.title,
        authors,
        cover: coverUrl,
        summary: m.description,
        tags: m.genre?.slice(0, 5),
        kind: 'manga',
      };
    });

    return {
      items,
      next: data.hasNextPage ? String(page + 1) : undefined,
    };
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    const extensions = await this.getInstalledExtensions();
    const sourceId = extensions.length > 0 ? extensions[0].id : '';

    if (!sourceId) {
      return { items: [] };
    }

    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `${this.baseUrl}/api/v1/source/${sourceId}/search?query=${encodeURIComponent(query.trim())}&page=${page}`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to search Suwayomi: ${res.statusText}`);
    }

    const data = (await res.json()) as SuwayomiMangaListResponse;
    const items: CatalogEntry[] = (data.mangaList || []).map((m) => {
      const coverUrl = m.thumbnailUrl ? this.resolveUrl(m.thumbnailUrl) : undefined;
      const authors = m.author ? [m.author] : m.artist ? [m.artist] : ['Tachiyomi Creator'];

      return {
        id: `suwayomi:${this.id}:${sourceId}:${m.id}`,
        title: m.title,
        authors,
        cover: coverUrl,
        summary: m.description,
        tags: m.genre?.slice(0, 5),
        kind: 'manga',
      };
    });

    return {
      items,
      next: data.hasNextPage ? String(page + 1) : undefined,
    };
  }

  async details(id: string): Promise<CatalogEntry> {
    // ID format: suwayomi:{instanceId}:{sourceId}:{mangaId} or suwayomi:{mangaId}
    const parts = id.split(':');
    const mangaId = parts[parts.length - 1];
    const url = `${this.baseUrl}/api/v1/manga/${mangaId}`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to fetch Suwayomi manga details: ${res.statusText}`);
    }

    const m = (await res.json()) as SuwayomiMangaItem;
    const coverUrl = m.thumbnailUrl ? this.resolveUrl(m.thumbnailUrl) : undefined;
    const authors = m.author ? [m.author] : m.artist ? [m.artist] : ['Tachiyomi Creator'];

    return {
      id,
      title: m.title,
      authors,
      cover: coverUrl,
      summary: m.description,
      tags: m.genre?.slice(0, 6),
      kind: 'manga',
      status: m.status?.toLowerCase(),
    };
  }

  async chapters(seriesId: string): Promise<ChapterInfo[]> {
    const parts = seriesId.split(':');
    const mangaId = parts[parts.length - 1];
    const url = `${this.baseUrl}/api/v1/manga/${mangaId}/chapters`;

    const res = await net.fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to fetch Suwayomi chapters: ${res.statusText}`);
    }

    const rawChapters = (await res.json()) as SuwayomiChapterItem[];
    if (!Array.isArray(rawChapters)) return [];

    return rawChapters.map((ch) => ({
      id: String(ch.id),
      title: ch.name || (ch.chapterNumber !== undefined ? `Chapter ${ch.chapterNumber}` : 'Chapter'),
      number: ch.chapterNumber,
      scanlationGroup: ch.scanlator || 'Suwayomi',
      publishedAt: ch.uploadDate ? new Date(ch.uploadDate).toISOString() : undefined,
    }));
  }

  async pages(chapterId: string): Promise<PageRef[]> {
    // Try fetching pages endpoint
    const url = `${this.baseUrl}/api/v1/chapter/${chapterId}/pages`;
    try {
      const res = await net.fetch(url, { headers: this.getHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.map((item, idx) => {
            const pageUrl = typeof item === 'string' ? item : item.url || item.path;
            return {
              index: idx + 1,
              url: this.resolveUrl(pageUrl || `/api/v1/chapter/${chapterId}/page/${idx}`),
            };
          });
        }
      }
    } catch {
      // Fallback below
    }

    // Default Suwayomi page index convention
    // Fetch chapter info for pageCount
    const chUrl = `${this.baseUrl}/api/v1/chapter/${chapterId}`;
    const chRes = await net.fetch(chUrl, { headers: this.getHeaders() });
    if (!chRes.ok) {
      throw new Error(`Failed to load Suwayomi chapter: ${chRes.statusText}`);
    }

    const ch = (await chRes.json()) as SuwayomiChapterItem;
    const count = ch.pageCount || 20;
    const pages: PageRef[] = [];
    for (let i = 0; i < count; i++) {
      pages.push({
        index: i + 1,
        url: `${this.baseUrl}/api/v1/chapter/${chapterId}/page/${i}`,
      });
    }
    return pages;
  }

  credit(chapter: ChapterInfo): string {
    return `Scanlation: ${chapter.scanlationGroup || 'Tachiyomi Extension'} · Suwayomi Server`;
  }
}

export const defaultSuwayomiSource = new SuwayomiSource(
  'suwayomi',
  'Suwayomi (Tachiyomi)',
  'http://localhost:4567',
);
