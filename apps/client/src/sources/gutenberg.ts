import { net } from '../lib/net';
import { db } from '../db';
import type {
  CatalogEntry,
  CatalogFormat,
  CatalogPage,
  CatalogSection,
  CatalogSource,
} from './types';

interface GutendexPerson {
  name: string;
  birth_year?: number;
  death_year?: number;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexPerson[];
  translators?: GutendexPerson[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
}

function parseGutendexBook(b: GutendexBook): CatalogEntry {
  const formats: CatalogFormat[] = [];

  // Look for preferred EPUB versions first: epub3.images -> epub.images -> general epub
  let epubUrl: string | undefined;
  for (const [, url] of Object.entries(b.formats)) {
    if (url.includes('.epub3.images')) {
      epubUrl = url;
      break;
    }
  }
  if (!epubUrl) {
    for (const [mime, url] of Object.entries(b.formats)) {
      if (url.includes('.epub.images') || (mime === 'application/epub+zip' && !url.includes('.noimages'))) {
        epubUrl = url;
        break;
      }
    }
  }
  if (!epubUrl && b.formats['application/epub+zip']) {
    epubUrl = b.formats['application/epub+zip'];
  }

  if (epubUrl) {
    // Text-only edition first: it's often a tiny fraction of the illustrated one
    // (Pride and Prejudice: 0.5 MB vs 24.8 MB). download() picks between them.
    formats.push({ mime: 'application/epub+zip', url: `https://www.gutenberg.org/ebooks/${b.id}.epub.noimages`, label: 'Text only' });
    formats.push({ mime: 'application/epub+zip', url: epubUrl, label: 'With illustrations' });
  }

  // Cover image
  const coverUrl = b.formats['image/jpeg'];

  return {
    id: `gutenberg:${b.id}`,
    title: b.title,
    authors: b.authors.map((a) => {
      if (a.name.includes(',')) {
        return a.name.split(',').reverse().map((s) => s.trim()).join(' ');
      }
      return a.name.trim();
    }),
    cover: coverUrl,
    languages: b.languages,
    tags: [...b.subjects.slice(0, 5), ...b.bookshelves.slice(0, 3)],
    formats,
    kind: 'book',
  };
}

const MAX_AUTO_ILLUSTRATED_BYTES = 6 * 1024 * 1024;

// Gutendex can take a minute to answer. Catalog pages are cached on the device:
// fresh copies (< 6h) are returned instantly, and a stale copy is shown if the
// live request hasn't answered within a few seconds (it still refreshes the cache).
const GUTENDEX_FRESH_MS = 6 * 60 * 60 * 1000;
const GUTENDEX_STALE_WAIT_MS = 6000;

async function gutendexJson<T>(url: string, errorPrefix: string): Promise<T> {
  const key = `gutendex:${url}`;
  const cached = (await db.kv.get(key).catch(() => undefined))?.value as { at: number; data: T } | undefined;
  if (cached && Date.now() - cached.at < GUTENDEX_FRESH_MS) return cached.data;

  const live = (async () => {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`${errorPrefix}: ${res.statusText}`);
    const data = (await res.json()) as T;
    void db.kv.put({ key, value: { at: Date.now(), data } }).catch(() => {});
    return data;
  })();
  if (!cached) return live;
  return Promise.race([
    live,
    new Promise<T>((resolve) => setTimeout(() => resolve(cached.data), GUTENDEX_STALE_WAIT_MS)),
  ]).catch(() => cached.data);
}

export class GutenbergSource implements CatalogSource {
  id = 'gutenberg';
  name = 'Project Gutenberg';
  icon = 'BookOpen';
  kind = 'books' as const;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'popular', title: 'Popular' },
      { id: 'latest', title: 'Latest' },
      { id: 'topic:fiction', title: 'Fiction' },
      { id: 'topic:science fiction', title: 'Sci-Fi' },
      { id: 'topic:mystery', title: 'Mystery' },
      { id: 'topic:philosophy', title: 'Philosophy' },
      { id: 'topic:history', title: 'History' },
    ];
  }

  filters = [
    {
      id: 'languages',
      label: 'Language',
      options: [
        { value: '', label: 'Any language' },
        { value: 'en', label: 'English' },
        { value: 'fr', label: 'French' },
        { value: 'de', label: 'German' },
        { value: 'es', label: 'Spanish' },
        { value: 'it', label: 'Italian' },
        { value: 'pt', label: 'Portuguese' },
        { value: 'nl', label: 'Dutch' },
        { value: 'fi', label: 'Finnish' },
        { value: 'zh', label: 'Chinese' },
        { value: 'la', label: 'Latin' },
      ],
    },
  ];

  async browse(sectionId: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
    let url = cursor;
    if (!url) {
      const params = new URLSearchParams();
      if (sectionId === 'popular') params.set('sort', 'popular');
      else if (sectionId === 'latest') params.set('sort', 'descending');
      else if (sectionId.startsWith('topic:')) params.set('topic', sectionId.slice(6));
      if (filters?.languages) params.set('languages', filters.languages);
      url = `https://gutendex.com/books?${params.toString()}`;
    }

    const data = await gutendexJson<GutendexResponse>(url, 'Failed to browse Gutenberg');

    return {
      items: data.results.map(parseGutendexBook),
      next: data.next || undefined,
    };
  }

  async search(
    query: string,
    cursor?: string,
    filters?: Record<string, string>,
  ): Promise<CatalogPage> {
    let url = cursor;
    if (!url) {
      const params = new URLSearchParams();
      if (query.trim()) params.set('search', query.trim());
      if (filters?.languages) params.set('languages', filters.languages);
      if (filters?.topic) params.set('topic', filters.topic);
      url = `https://gutendex.com/books?${params.toString()}`;
    }

    const data = await gutendexJson<GutendexResponse>(url, 'Failed to search Gutenberg');

    return {
      items: data.results.map(parseGutendexBook),
      next: data.next || undefined,
    };
  }

  async details(id: string): Promise<CatalogEntry> {
    const rawId = id.replace(/^gutenberg:/, '');
    const url = `https://gutendex.com/books/${rawId}`;
    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch Gutenberg book ${id}: ${res.statusText}`);
    }
    const data = (await res.json()) as GutendexBook;
    return parseGutendexBook(data);
  }

  async download(
    entry: CatalogEntry,
    _format: string,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const epubs = (entry.formats ?? []).filter((f) => f.mime === 'application/epub+zip');
    if (!epubs.length) {
      throw new Error('No downloadable EPUB format available for this book.');
    }
    // An explicit URL picks that edition; otherwise take the illustrated edition
    // only when it's small enough to arrive in reasonable time.
    let chosen = epubs.find((f) => f.url === _format);
    if (!chosen) {
      const illustrated = epubs.find((f) => f.label === 'With illustrations');
      const textOnly = epubs.find((f) => f.label === 'Text only');
      const size = illustrated ? await net.size(illustrated.url) : undefined;
      chosen =
        illustrated && (!textOnly || (size !== undefined && size <= MAX_AUTO_ILLUSTRATED_BYTES))
          ? illustrated
          : (textOnly ?? epubs[0]);
    }

    onProgress?.(0.05);
    const blob = await net.download(chosen.url, {
      onProgress: (f) => onProgress?.(0.05 + f * 0.9),
    });
    onProgress?.(1.0);

    const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    return new File([blob], `${safeTitle}.epub`, {
      type: 'application/epub+zip',
    });
  }
}

export const gutenbergSource = new GutenbergSource();
