import { net } from '../lib/net';
import type {
  CatalogEntry,
  CatalogFormat,
  CatalogPage,
  CatalogSection,
  CatalogSource,
} from './types';

interface Opds2Link {
  rel?: string;
  href: string;
  type?: string;
}

interface Opds2Author {
  name?: string;
}

interface Opds2Publication {
  id?: string;
  metadata?: {
    identifier?: string;
    title?: string;
    author?: string | Opds2Author | Array<string | Opds2Author>;
    description?: string;
  };
  links?: Opds2Link[];
}

interface Opds2Feed {
  publications?: Opds2Publication[];
  links?: Opds2Link[];
}

export class OpdsSource implements CatalogSource {
  id: string;
  name: string;
  icon = 'BookOpen';
  kind = 'books' as const;
  baseUrl: string;
  authHeader?: string;

  constructor(
    id: string,
    name: string,
    baseUrl: string,
    credentials?: { username?: string; password?: string; apiKey?: string },
  ) {
    this.id = id;
    this.name = name;
    this.baseUrl = baseUrl;
    if (credentials?.username || credentials?.password) {
      const u = credentials.username || '';
      const p = credentials.password || '';
      this.authHeader = `Basic ${btoa(`${u}:${p}`)}`;
    } else if (credentials?.apiKey) {
      this.authHeader = `Bearer ${credentials.apiKey}`;
    }
  }

  private async fetchFeed(url: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }
    return net.fetch(url, { headers });
  }

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'root', title: 'Catalog' },
      { id: 'new', title: 'New Releases' },
    ];
  }

  async browse(_sectionId: string, cursor?: string): Promise<CatalogPage> {
    const url = cursor || this.baseUrl;
    const res = await this.fetchFeed(url);
    if (!res.ok) {
      throw new Error(`Failed to load OPDS feed: ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const data = await res.json();
      return this.parseOpds2(data);
    } else {
      const text = await res.text();
      return this.parseOpds1(text, url);
    }
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    let url = cursor;
    if (!url) {
      // Basic fallback search if OpenSearch URL is not already resolved
      const sep = this.baseUrl.includes('?') ? '&' : '?';
      url = `${this.baseUrl}${sep}q=${encodeURIComponent(query)}`;
    }
    const res = await this.fetchFeed(url);
    if (!res.ok) {
      throw new Error(`Failed to search OPDS: ${res.statusText}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const data = await res.json();
      return this.parseOpds2(data);
    } else {
      const text = await res.text();
      return this.parseOpds1(text, url);
    }
  }

  async details(id: string): Promise<CatalogEntry> {
    return {
      id,
      title: 'OPDS Publication',
      authors: [],
      kind: 'book',
    };
  }

  async download(
    entry: CatalogEntry,
    _format: string,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const format = entry.formats?.find(
      (f) => f.mime === 'application/epub+zip',
    ) || entry.formats?.[0];
    if (!format) {
      throw new Error('No acquisition download format available for this book.');
    }

    onProgress?.(0.1);
    const res = await this.fetchFeed(format.url);
    if (!res.ok) {
      throw new Error(`Failed to download book: ${res.statusText}`);
    }

    onProgress?.(0.5);
    const blob = await res.blob();
    onProgress?.(1.0);

    const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    return new File([blob], `${safeTitle}.epub`, {
      type: 'application/epub+zip',
    });
  }

  private parseOpds1(xmlText: string, currentUrl: string): CatalogPage {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const entries = Array.from(doc.querySelectorAll('entry'));
    const items: CatalogEntry[] = [];

    const resolveUrl = (href: string | null) => {
      if (!href) return undefined;
      try {
        return new URL(href, currentUrl).href;
      } catch {
        return href;
      }
    };

    for (const entry of entries) {
      const id = entry.querySelector('id')?.textContent?.trim() || uidFallback();
      const title = entry.querySelector('title')?.textContent?.trim() || 'Untitled';
      const authors = Array.from(entry.querySelectorAll('author name'))
        .map((n) => n.textContent?.trim() || '')
        .filter(Boolean);
      const summary =
        entry.querySelector('summary')?.textContent?.trim() ||
        entry.querySelector('content')?.textContent?.trim();

      const formats: CatalogFormat[] = [];
      let cover: string | undefined;

      const links = Array.from(entry.querySelectorAll('link'));
      for (const link of links) {
        const rel = link.getAttribute('rel') || '';
        const href = resolveUrl(link.getAttribute('href'));
        const type = link.getAttribute('type') || '';

        if (
          (rel.includes('image') || rel.includes('thumbnail')) &&
          href &&
          !cover
        ) {
          cover = href;
        }

        if (rel.includes('acquisition') && href) {
          formats.push({
            mime: type || 'application/epub+zip',
            url: href,
          });
        }
      }

      items.push({
        id: `${this.id}:${id}`,
        title,
        authors: authors.length > 0 ? authors : ['Unknown author'],
        cover,
        summary,
        formats,
        kind: 'book',
      });
    }

    // Look for next page link
    const nextLink = doc.querySelector('link[rel="next"]');
    const next = resolveUrl(nextLink?.getAttribute('href') || null);

    return { items, next };
  }

  private parseOpds2(data: Opds2Feed): CatalogPage {
    const publications = data?.publications || [];
    const items: CatalogEntry[] = [];

    for (const pub of publications) {
      const meta = pub.metadata || {};
      const formats: CatalogFormat[] = [];
      let cover: string | undefined;

      for (const link of pub.links || []) {
        if (link.rel === 'cover' || link.rel === 'thumbnail') {
          cover = link.href;
        }
        if (link.rel === 'acquisition' || link.type?.includes('epub')) {
          formats.push({
            mime: link.type || 'application/epub+zip',
            url: link.href,
          });
        }
      }

      let authors: string[] = ['Unknown author'];
      if (Array.isArray(meta.author)) {
        authors = meta.author.map((a) => (typeof a === 'string' ? a : a.name || 'Unknown'));
      } else if (meta.author) {
        authors = [typeof meta.author === 'string' ? meta.author : meta.author.name || 'Unknown'];
      }

      items.push({
        id: `${this.id}:${meta.identifier || pub.id || uidFallback()}`,
        title: meta.title || 'Untitled',
        authors,
        cover,
        summary: meta.description,
        formats,
        kind: 'book',
      });
    }

    const nextLink = (data?.links || []).find((l) => l.rel === 'next');
    return { items, next: nextLink?.href };
  }
}

function uidFallback(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Built-in Standard Ebooks Source (Public New Releases Feed)
export const standardEbooksSource = new OpdsSource(
  'standardebooks',
  'Standard Ebooks',
  'https://standardebooks.org/feeds/opds/new-releases',
);
