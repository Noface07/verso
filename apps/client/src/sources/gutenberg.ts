import { net } from '../lib/net';
import type {
  CatalogEntry,
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
  const formats: { mime: string; url: string }[] = [];

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
    formats.push({ mime: 'application/epub+zip', url: epubUrl });
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

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    let url = cursor;
    if (!url) {
      const base = 'https://gutendex.com/books';
      if (sectionId === 'popular') {
        url = `${base}?sort=popular`;
      } else if (sectionId === 'latest') {
        url = `${base}?sort=descending`;
      } else if (sectionId.startsWith('topic:')) {
        const topic = encodeURIComponent(sectionId.slice(6));
        url = `${base}?topic=${topic}`;
      } else {
        url = base;
      }
    }

    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to browse Gutenberg: ${res.statusText}`);
    }
    const data = (await res.json()) as GutendexResponse;

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

    const res = await net.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to search Gutenberg: ${res.statusText}`);
    }
    const data = (await res.json()) as GutendexResponse;

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
    const formatEntry = entry.formats?.find(
      (f) => f.mime === 'application/epub+zip',
    ) || entry.formats?.[0];
    if (!formatEntry) {
      throw new Error('No downloadable EPUB format available for this book.');
    }

    onProgress?.(0.1);
    const res = await net.fetch(formatEntry.url);
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
}

export const gutenbergSource = new GutenbergSource();
