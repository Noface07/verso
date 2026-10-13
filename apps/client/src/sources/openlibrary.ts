import { net } from '../lib/net';
import { cachedJson } from '../lib/apiCache';
import type {
  CatalogEntry,
  CatalogFormat,
  CatalogPage,
  CatalogSection,
  CatalogSource,
} from './types';

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  subject?: string[];
  language?: string[];
  ia?: string[];
  edition_count?: number;
}

interface OpenLibrarySearchResponse {
  numFound: number;
  start: number;
  docs: OpenLibraryDoc[];
}

interface OpenLibrarySubjectWork {
  key: string;
  title: string;
  authors?: Array<{ key: string; name: string }>;
  cover_id?: number;
  first_publish_year?: number;
  subject?: string[];
  ia?: string;
}

interface OpenLibrarySubjectResponse {
  name: string;
  work_count: number;
  works: OpenLibrarySubjectWork[];
}

interface OpenLibraryTrendingResponse {
  query?: string;
  works: OpenLibraryDoc[];
}

interface OpenLibraryWorkDetail {
  key: string;
  title: string;
  description?: string | { type: string; value: string };
  covers?: number[];
  subjects?: string[];
}

function parseOpenLibraryDoc(doc: OpenLibraryDoc): CatalogEntry {
  const rawId = doc.key.replace(/^\/works\//, '');
  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : undefined;

  const formats: CatalogFormat[] = [];
  const primaryIa = doc.ia && doc.ia.length > 0 ? doc.ia[0] : undefined;

  if (primaryIa) {
    formats.push({
      mime: 'application/epub+zip',
      url: `https://archive.org/download/${primaryIa}/${primaryIa}.epub`,
      label: 'Free EPUB (Internet Archive)',
    });
  }

  return {
    id: `openlibrary:${rawId}`,
    title: doc.title,
    authors: doc.author_name || ['Unknown Author'],
    cover: coverUrl,
    languages: doc.language,
    tags: doc.subject?.slice(0, 5),
    formats,
    kind: 'book',
    year: doc.first_publish_year,
  };
}

function parseSubjectWork(work: OpenLibrarySubjectWork): CatalogEntry {
  const rawId = work.key.replace(/^\/works\//, '');
  const coverUrl = work.cover_id
    ? `https://covers.openlibrary.org/b/id/${work.cover_id}-M.jpg`
    : undefined;

  const formats: CatalogFormat[] = [];
  if (work.ia) {
    formats.push({
      mime: 'application/epub+zip',
      url: `https://archive.org/download/${work.ia}/${work.ia}.epub`,
      label: 'Free EPUB (Internet Archive)',
    });
  }

  return {
    id: `openlibrary:${rawId}`,
    title: work.title,
    authors: work.authors?.map((a) => a.name) || ['Unknown Author'],
    cover: coverUrl,
    tags: work.subject?.slice(0, 5),
    formats,
    kind: 'book',
    year: work.first_publish_year,
  };
}

export class OpenLibrarySource implements CatalogSource {
  id = 'openlibrary';
  name = 'Open Library';
  icon = 'BookOpen';
  kind = 'books' as const;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'trending', title: 'Trending Today' },
      { id: 'classics', title: 'Classic Literature' },
      { id: 'fiction', title: 'Fiction' },
      { id: 'fantasy', title: 'Fantasy' },
      { id: 'science_fiction', title: 'Sci-Fi' },
      { id: 'romance', title: 'Romance' },
      { id: 'history', title: 'History' },
    ];
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const limit = 24;
    const offset = cursor ? parseInt(cursor, 10) : 0;

    if (sectionId === 'trending') {
      const url = 'https://openlibrary.org/trending/daily.json';
      const data = await cachedJson<OpenLibraryTrendingResponse>(
        url,
        async () => {
          const res = await net.fetch(url);
          if (!res.ok) throw new Error(`Open Library trending error: ${res.statusText}`);
          return (await res.json()) as OpenLibraryTrendingResponse;
        },
        { freshMs: 60 * 60_000 },
      );

      const all = data.works || [];
      const sliced = all.slice(offset, offset + limit);
      const next = offset + limit < all.length ? String(offset + limit) : undefined;
      return {
        items: sliced.map(parseOpenLibraryDoc),
        next,
      };
    }

    const subjectMap: Record<string, string> = {
      classics: 'classic_literature',
      fiction: 'fiction',
      fantasy: 'fantasy',
      science_fiction: 'science_fiction',
      romance: 'romance',
      history: 'history',
    };

    const subject = subjectMap[sectionId] || sectionId;
    const url = `https://openlibrary.org/subjects/${subject}.json?limit=${limit}&offset=${offset}`;

    const data = await cachedJson<OpenLibrarySubjectResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Open Library subject error: ${res.statusText}`);
        return (await res.json()) as OpenLibrarySubjectResponse;
      },
      { freshMs: 60 * 60_000 },
    );

    const items = (data.works || []).map(parseSubjectWork);
    const hasMore = offset + limit < (data.work_count || 0);
    const next = hasMore ? String(offset + limit) : undefined;

    return { items, next };
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    const limit = 24;
    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query.trim())}&page=${page}&limit=${limit}`;

    const data = await cachedJson<OpenLibrarySearchResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Open Library search error: ${res.statusText}`);
        return (await res.json()) as OpenLibrarySearchResponse;
      },
      { freshMs: 30 * 60_000 },
    );

    const items = (data.docs || []).map(parseOpenLibraryDoc);
    const hasMore = page * limit < (data.numFound || 0);
    const next = hasMore ? String(page + 1) : undefined;

    return { items, next };
  }

  async details(id: string): Promise<CatalogEntry> {
    const rawId = id.replace(/^openlibrary:/, '');
    const url = `https://openlibrary.org/works/${rawId}.json`;

    const data = await cachedJson<OpenLibraryWorkDetail>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Open Library details error: ${res.statusText}`);
        return (await res.json()) as OpenLibraryWorkDetail;
      },
      { freshMs: 6 * 60 * 60_000 },
    );

    let summary = '';
    if (typeof data.description === 'string') {
      summary = data.description;
    } else if (data.description && typeof data.description === 'object' && 'value' in data.description) {
      summary = data.description.value;
    }

    const coverId = data.covers && data.covers.length > 0 ? data.covers[0] : undefined;
    const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined;

    return {
      id: `openlibrary:${rawId}`,
      title: data.title,
      authors: [],
      cover: coverUrl,
      summary,
      tags: data.subjects?.slice(0, 6),
      kind: 'book',
    };
  }

  async download(
    entry: CatalogEntry,
    formatUrl: string,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const epubs = (entry.formats ?? []).filter((f) => f.mime === 'application/epub+zip');
    const chosen = epubs.find((f) => f.url === formatUrl) || epubs[0];

    if (!chosen) {
      throw new Error('This title is in Open Library for borrowing or archive viewing, but has no direct public domain EPUB download.');
    }

    onProgress?.(0.05);
    const blob = await net.download(chosen.url, {
      onProgress: (p) => onProgress?.(0.05 + p * 0.9),
    });
    onProgress?.(1.0);

    const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    return new File([blob], `${safeTitle}.epub`, {
      type: 'application/epub+zip',
    });
  }
}

export const openLibrarySource = new OpenLibrarySource();
