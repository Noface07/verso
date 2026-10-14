import { net } from '../lib/net';
import { cachedJson } from '../lib/apiCache';
import { db } from '../db';
import type {
  CatalogEntry,
  CatalogFilter,
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

  filters: CatalogFilter[] = [
    {
      id: 'feed',
      label: 'Feed',
      options: [
        { value: '', label: '🔥 Popular', hint: 'Browse most popular titles' },
        { value: 'latest', label: '⏱️ Latest Updates', hint: 'Browse recently updated chapters' },
      ],
    },
    {
      id: 'lang',
      label: 'Language',
      options: [
        { value: '', label: '🌐 All (EN & Multi)', hint: 'All English & multi-language sources' },
        { value: 'en', label: '🇬🇧 English (EN)', hint: 'Show only English sources' },
        { value: 'all', label: '🌍 Multi (ALL)', hint: 'Show only multi-language sources' },
      ],
    },
  ];

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

  private getFetch(): (input: string | URL, init?: RequestInit) => Promise<Response> {
    return typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? (input, init) => window.fetch(input, init)
      : (input, init) => net.fetch(input, init);
  }

  async getInstalledExtensions(forceRefresh = false): Promise<SuwayomiSourceInfo[]> {
    const cacheKey = `suwayomi:${this.id}:extensions`;
    if (forceRefresh) {
      await db.kv.delete(`cache:${cacheKey}`).catch(() => {});
    }
    const url = `${this.baseUrl}/api/v1/source/list`;
    return cachedJson<SuwayomiSourceInfo[]>(
      cacheKey,
      async () => {
        try {
          const fetchFn = this.getFetch();
          const res = await fetchFn(url, { headers: this.getHeaders() });
          if (!res.ok) return [];
          const list = (await res.json()) as SuwayomiSourceInfo[];
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      },
      { freshMs: forceRefresh ? 0 : 10 * 60_000 },
    );
  }

  /** Fetch all extensions in the Suwayomi extension store (Keiyoushi repo & installed) */
  async getExtensionList(): Promise<SuwayomiExtension[]> {
    const url = `${this.baseUrl}/api/graphql`;
    try {
      const fetchImpl = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : net.fetch;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          query: `
            query GetExtensions {
              extensions {
                nodes {
                  name
                  pkgName
                  lang
                  isInstalled
                  hasUpdate
                  iconUrl
                  apkName
                }
              }
            }
          `,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          data?: {
            extensions?: {
              nodes?: Array<{
                name: string;
                pkgName: string;
                lang: string;
                isInstalled: boolean;
                hasUpdate: boolean;
                iconUrl?: string;
                apkName?: string;
              }>;
            };
          };
        };

        const rawNodes = data.data?.extensions?.nodes;
        if (Array.isArray(rawNodes) && rawNodes.length > 0) {
          const nodes = rawNodes.filter(
            (node) =>
              !node.pkgName.endsWith('.keiyoushi') &&
              !node.pkgName.endsWith('.mihon') &&
              !node.name.toLowerCase().includes('outdated app') &&
              !node.name.toLowerCase().includes('update to mihon') &&
              (node.isInstalled || node.lang === 'en' || node.lang === 'all'),
          );
          return nodes.map((node) => {
            const verMatch = node.apkName?.match(/-v?([0-9.]+)\.apk$/i);
            const versionName = verMatch ? verMatch[1] : '1.0';
            return {
              name: node.name,
              pkgName: node.pkgName,
              versionName,
              lang: node.lang || 'all',
              isNsfw: false,
              installed: Boolean(node.isInstalled),
              hasUpdate: Boolean(node.hasUpdate),
              iconUrl: node.iconUrl ? this.resolveUrl(node.iconUrl) : undefined,
            };
          });
        }
      }
    } catch (err) {
      console.warn('[Suwayomi] GraphQL GetExtensions failed, trying fallback:', err);
    }

    // Fallback: If GraphQL returned no extensions or errored, list installed sources from Suwayomi REST API
    try {
      const installedSources = await this.getInstalledExtensions();
      if (installedSources.length > 0) {
        return installedSources
          .filter((s) => s.id !== '0')
          .map((s) => ({
            name: s.name,
            pkgName: `source:${s.id}`,
            versionName: '1.0',
            lang: s.lang || 'all',
            isNsfw: false,
            installed: true,
            hasUpdate: false,
            iconUrl: s.iconUrl ? this.resolveUrl(s.iconUrl) : undefined,
          }));
      }
    } catch {
      // Ignore
    }

    return [];
  }

  /** Install an extension from the Suwayomi extension store */
  async installExtension(pkgName: string): Promise<boolean> {
    const url = `${this.baseUrl}/api/graphql`;
    try {
      const fetchImpl = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : net.fetch;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          query: `
            mutation InstallExt($input: UpdateExtensionInput!) {
              updateExtension(input: $input) {
                clientMutationId
              }
            }
          `,
          variables: {
            input: {
              id: pkgName,
              patch: { install: true },
            },
          },
        }),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { errors?: unknown[] };
      return !json.errors || json.errors.length === 0;
    } catch {
      return false;
    }
  }

  /** Uninstall an extension */
  async uninstallExtension(pkgName: string): Promise<boolean> {
    const url = `${this.baseUrl}/api/graphql`;
    try {
      const fetchImpl = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : net.fetch;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(),
        },
        body: JSON.stringify({
          query: `
            mutation UninstallExt($input: UpdateExtensionInput!) {
              updateExtension(input: $input) {
                clientMutationId
              }
            }
          `,
          variables: {
            input: {
              id: pkgName,
              patch: { uninstall: true },
            },
          },
        }),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { errors?: unknown[] };
      return !json.errors || json.errors.length === 0;
    } catch {
      return false;
    }
  }

  private lastBrowsedSourceId = '';

  private sortSources(extensions: SuwayomiSourceInfo[]): SuwayomiSourceInfo[] {
    // Only keep English ('en'), multi-language ('all'), and local on-disk source ('0')
    const realSources = extensions.filter(
      (ext) => ext.id !== '0' && (ext.lang === 'en' || ext.lang === 'all'),
    );

    // Prioritize prominent sources like MangaDex to the top of English sources if present
    const dexSources = realSources.filter((ext) => /mangadex/i.test(ext.name));
    const otherFavSources = realSources.filter(
      (ext) => /kodansha|globalcomix/i.test(ext.name) && !/mangadex/i.test(ext.name),
    );
    const regularEn = realSources.filter(
      (ext) => !/mangadex|kodansha|globalcomix/i.test(ext.name),
    );

    const localSources = extensions.filter((ext) => ext.id === '0');
    return [...dexSources, ...otherFavSources, ...regularEn, ...localSources];
  }

  async sections(forceRefresh = false): Promise<CatalogSection[]> {
    let extensions = await this.getInstalledExtensions(forceRefresh);
    if (extensions.length === 0 && !forceRefresh) {
      extensions = await this.getInstalledExtensions(true);
    }
    if (extensions.length === 0) {
      return [
        { id: 'all', title: 'Tachiyomi Extensions' },
      ];
    }

    const sorted = this.sortSources(extensions);

    return sorted.map((ext) => ({
      id: ext.id,
      title:
        ext.id === '0'
          ? 'Local source (on-disk)'
          : `${ext.name} (${ext.lang.toUpperCase()})`,
    }));
  }

  async browse(sectionId: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
    let extensions = await this.getInstalledExtensions();
    if (extensions.length === 0) {
      extensions = await this.getInstalledExtensions(true);
    }
    const sorted = this.sortSources(extensions);
    const defaultSourceId = sorted.length > 0 ? sorted[0].id : extensions[0]?.id || '';
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
    this.lastBrowsedSourceId = sourceId;

    const page = cursor ? parseInt(cursor, 10) : 1;
    const isLatest = filters?.feed === 'latest';
    const primaryEndpoint = isLatest ? 'latest' : 'popular';
    const fallbackEndpoint = isLatest ? 'popular' : 'latest';
    const url = `${this.baseUrl}/api/v1/source/${sourceId}/${primaryEndpoint}/${page}`;

    let res = await this.getFetch()(url, { headers: this.getHeaders() });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) {
      // Fallback to alternative endpoint if primary endpoint fails
      const fallbackUrl = `${this.baseUrl}/api/v1/source/${sourceId}/${fallbackEndpoint}/${page}`;
      const fallbackRes = await this.getFetch()(fallbackUrl, { headers: this.getHeaders() });
      const fallbackContentType = fallbackRes.headers.get('content-type') || '';
      if (fallbackRes.ok && !fallbackContentType.includes('text/html')) {
        res = fallbackRes;
      } else {
        let detail = res.statusText;
        try {
          const errText = await res.text();
          if (errText) detail = errText.slice(0, 120);
        } catch {
          // Body unreadable: keep the status text as the detail.
        }
        throw new Error(`Failed to load Suwayomi source: ${detail || res.statusText || 'Request failed'}`);
      }
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

  async search(query: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
    let extensions = await this.getInstalledExtensions();
    if (extensions.length === 0) {
      extensions = await this.getInstalledExtensions(true);
    }
    const sorted = this.sortSources(extensions);
    const sourceId =
      filters?.source ||
      this.lastBrowsedSourceId ||
      (sorted.length > 0 ? sorted[0].id : extensions[0]?.id || '');

    if (!sourceId) {
      return { items: [] };
    }

    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `${this.baseUrl}/api/v1/source/${sourceId}/search?query=${encodeURIComponent(query.trim())}&page=${page}`;

    const res = await this.getFetch()(url, { headers: this.getHeaders() });
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

    const res = await this.getFetch()(url, { headers: this.getHeaders() });
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

    const res = await this.getFetch()(url, { headers: this.getHeaders() });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) {
      throw new Error(`Failed to fetch Suwayomi chapters: ${res.statusText || 'Invalid response'}`);
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
    // 1. Primary: Query Suwayomi GraphQL mutation fetchChapterPages
    try {
      const numId = parseInt(chapterId, 10);
      if (!Number.isNaN(numId)) {
        const gqlRes = await this.getFetch()(`${this.baseUrl}/api/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getHeaders(),
          },
          body: JSON.stringify({
            query: `
              mutation FetchPages($input: FetchChapterPagesInput!) {
                fetchChapterPages(input: $input) {
                  chapter {
                    id
                    pageCount
                  }
                  pages
                }
              }
            `,
            variables: { input: { chapterId: numId } },
          }),
        });

        const contentType = gqlRes.headers.get('content-type') || '';
        if (gqlRes.ok && !contentType.includes('text/html')) {
          const gqlData = (await gqlRes.json()) as {
            data?: {
              fetchChapterPages?: {
                pages?: string[];
                chapter?: { pageCount?: number };
              };
            };
          };
          const rawPages = gqlData.data?.fetchChapterPages?.pages;
          if (Array.isArray(rawPages) && rawPages.length > 0) {
            return rawPages.map((pagePath, idx) => ({
              index: idx + 1,
              url: this.resolveUrl(pagePath),
            }));
          }
        }
      }
    } catch {
      // Fallback below
    }

    // 2. Fallback: Query REST chapter endpoint (used by test mocks and older Suwayomi versions)
    const chUrl = `${this.baseUrl}/api/v1/chapter/${chapterId}`;
    try {
      const chRes = await this.getFetch()(chUrl, { headers: this.getHeaders() });
      const contentType = chRes.headers.get('content-type') || '';
      if (chRes.ok && !contentType.includes('text/html')) {
        const ch = (await chRes.json()) as SuwayomiChapterItem;
        const count = ch.pageCount && ch.pageCount > 0 ? ch.pageCount : 20;
        const pages: PageRef[] = [];
        for (let i = 0; i < count; i++) {
          pages.push({
            index: i + 1,
            url: `${this.baseUrl}/api/v1/chapter/${chapterId}/page/${i}`,
          });
        }
        return pages;
      }
    } catch {
      // Fall through to error
    }

    throw new Error(`Failed to load chapter ${chapterId}: Suwayomi server did not return chapter pages`);
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
