import { net } from '../lib/net';
import { db } from '../db';
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

  private searchTemplate: string | null = null;

  /**
   * Navigation feeds (Standard Ebooks, Calibre, Kavita…) list sub-catalogues
   * instead of books; each becomes a section. A plain book feed is one section.
   */
  async sections(): Promise<CatalogSection[]> {
    const fallback = [{ id: 'root', title: 'Catalog' }];
    try {
      const res = await this.fetchFeed(this.baseUrl);
      if (!res.ok || (res.headers.get('content-type') || '').includes('json')) return fallback;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
      this.searchTemplate = await this.resolveSearchTemplate(doc);
      const nav = navigationSections(doc, this.baseUrl);
      return nav.length > 0 ? nav : fallback;
    } catch {
      return fallback;
    }
  }

  /** OpenSearch: either a template link in the feed or a description document. */
  private async resolveSearchTemplate(doc: Document): Promise<string | null> {
    const link = Array.from(doc.querySelectorAll('link')).find(
      (l) => l.getAttribute('rel') === 'search' && l.parentElement === doc.documentElement,
    );
    const href = link?.getAttribute('href');
    if (!href) return null;
    const abs = absoluteUrl(href, this.baseUrl);
    if (/\{searchTerms\}|%7BsearchTerms%7D/i.test(abs)) return abs;
    try {
      const res = await this.fetchFeed(abs);
      if (!res.ok) return null;
      const desc = new DOMParser().parseFromString(await res.text(), 'text/xml');
      const urls = Array.from(desc.getElementsByTagNameNS('*', 'Url'));
      const tpl = (urls.find((u) => (u.getAttribute('type') || '').includes('atom')) ?? urls[0])?.getAttribute('template');
      return tpl ? absoluteUrl(tpl, abs) : null;
    } catch {
      return null;
    }
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    // Section ids from navigation feeds are the sub-catalogue URLs.
    const url = cursor || (/^https?:\/\//i.test(sectionId) ? sectionId : this.baseUrl);
    const res = await this.fetchFeed(url);
    if (res.status === 401 || res.status === 403) {
      throw new Error('This catalogue rejected the sign-in. Check the username or email you entered.');
    }
    if (!res.ok) {
      throw new Error(`Failed to load OPDS feed (HTTP ${res.status})`);
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
      if (this.searchTemplate) {
        url = this.searchTemplate
          .replace(/\{searchTerms\}|%7BsearchTerms%7D/gi, encodeURIComponent(query))
          .replace(/\{[^}]*\?\}/g, '');
      } else {
        // Fallback when the catalogue doesn't advertise OpenSearch.
        const sep = this.baseUrl.includes('?') ? '&' : '?';
        url = `${this.baseUrl}${sep}q=${encodeURIComponent(query)}`;
      }
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

      // Extract thumbnail from media:thumbnail if present
      const mediaThumb = entry.getElementsByTagNameNS('*', 'thumbnail')[0] || entry.querySelector('thumbnail');
      if (mediaThumb) {
        cover = resolveUrl(mediaThumb.getAttribute('url') || mediaThumb.getAttribute('href'));
      }

      const links = Array.from(entry.querySelectorAll('link'));
      for (const link of links) {
        const rel = link.getAttribute('rel') || '';
        const href = resolveUrl(link.getAttribute('href'));
        const type = link.getAttribute('type') || '';

        if (
          !cover &&
          (rel.includes('image') || rel.includes('thumbnail') || type.startsWith('image/')) &&
          href
        ) {
          cover = href;
        }

        if (
          href &&
          (rel.includes('acquisition') ||
            rel === 'enclosure' ||
            type.includes('epub') ||
            href.includes('.epub'))
        ) {
          if (type.includes('epub') || href.includes('.epub') || rel.includes('acquisition') || rel === 'enclosure') {
            formats.push({
              mime: type || 'application/epub+zip',
              url: href,
            });
          }
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

// Keeps OpenSearch placeholders like {searchTerms} intact (URL() would encode them).
function absoluteUrl(href: string, base: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  try {
    const b = new URL(base);
    return href.startsWith('/') ? `${b.origin}${href}` : new URL(href, base).href;
  } catch {
    return href;
  }
}

function navigationSections(doc: Document, base: string): CatalogSection[] {
  const out: CatalogSection[] = [];
  for (const entry of Array.from(doc.querySelectorAll('entry'))) {
    const links = Array.from(entry.querySelectorAll('link'));
    // Any downloadable entry means this is a list of books, not a menu.
    if (links.some((l) => (l.getAttribute('rel') || '').includes('acquisition'))) return [];
    const nav = links.find((l) => /opds-catalog|atom\+xml/i.test(l.getAttribute('type') || ''));
    const href = nav?.getAttribute('href');
    const title = entry.querySelector('title')?.textContent?.trim();
    if (href && title) out.push({ id: absoluteUrl(href, base), title });
  }
  return out;
}

function uidFallback(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SE_NEW_RELEASES = 'https://standardebooks.org/feeds/atom/new-releases';
const SE_OPDS_ROOT = 'https://standardebooks.org/feeds/opds';

// Standard Ebooks opens only its 15 newest releases to everyone; the full catalogue
// feeds are a Patrons Circle benefit (member email as username, no password).
class StandardEbooksSource extends OpdsSource {
  signIn = {
    label: 'Patrons Circle',
    usernameLabel: 'Patron email',
    help:
      'Standard Ebooks Patrons Circle members get the full catalogue. Enter the email you joined with; ' +
      'there is no password. It is stored only on this device.',
  };
  private patron = false;

  get notice() {
    if (this.patron) return undefined;
    return {
      text:
        'Standard Ebooks only shares its 15 newest releases openly. Patrons Circle members can sign in ' +
        '(button above) to browse the full catalogue.',
      linkLabel: 'Browse all on standardebooks.org',
      url: 'https://standardebooks.org/ebooks',
    };
  }

  private async loadAuth(): Promise<void> {
    const cred = await db.source_credentials.get(this.id).catch(() => undefined);
    const email = cred?.username?.trim();
    this.patron = !!email;
    this.authHeader = email ? `Basic ${btoa(`${email}:`)}` : undefined;
    this.baseUrl = email ? SE_OPDS_ROOT : SE_NEW_RELEASES;
  }

  override async sections(): Promise<CatalogSection[]> {
    await this.loadAuth();
    if (!this.patron) return [{ id: 'new', title: 'New releases' }];
    return super.sections();
  }

  override async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    await this.loadAuth();
    return super.browse(sectionId, cursor);
  }

  override async search(query: string, cursor?: string): Promise<CatalogPage> {
    await this.loadAuth();
    if (this.patron) return super.search(query, cursor);
    // The public feed has no search; filter its 15 entries locally.
    const q = query.toLowerCase();
    const { items } = await super.browse('new');
    return {
      items: items.filter(
        (i) => i.title.toLowerCase().includes(q) || i.authors.some((a) => a.toLowerCase().includes(q)),
      ),
    };
  }

  override async download(entry: CatalogEntry, format: string, onProgress?: (p: number) => void): Promise<File> {
    await this.loadAuth();
    return super.download(entry, format, onProgress);
  }
}

export const standardEbooksSource = new StandardEbooksSource(
  'standardebooks',
  'Standard Ebooks',
  'https://standardebooks.org/feeds/atom/new-releases',
);
