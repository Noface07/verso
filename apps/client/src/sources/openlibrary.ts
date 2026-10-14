import { net } from '../lib/net';
import { cachedJson } from '../lib/apiCache';
import type {
  CatalogEntry,
  CatalogFilter,
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
  id_project_gutenberg?: string[];
  ebook_access?: string;
  has_fulltext?: boolean;
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

  // 1. Direct Project Gutenberg formats if mapped
  if (doc.id_project_gutenberg && doc.id_project_gutenberg.length > 0) {
    const gid = doc.id_project_gutenberg[0];
    formats.push({
      mime: 'application/epub+zip',
      url: `https://www.gutenberg.org/ebooks/${gid}.epub3.images`,
      label: 'Free EPUB (Project Gutenberg)',
    });
    formats.push({
      mime: 'application/epub+zip',
      url: `https://www.gutenberg.org/ebooks/${gid}.epub.noimages`,
      label: 'Free EPUB (Text only)',
    });
  } else if (doc.ebook_access !== 'borrowable' && doc.ebook_access !== 'printdisabled' && doc.ia && doc.ia.length > 0) {
    // 2. Unrestricted public domain Internet Archive item
    const primaryIa = doc.ia[0];
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

const OPEN_LIBRARY_FILTERS: CatalogFilter[] = [
  {
    id: 'downloadable',
    label: 'Availability',
    options: [
      { value: '', label: 'All titles' },
      { value: '1', label: 'Free to download', hint: 'Only titles Verso can download (public domain).' },
    ],
  },
  {
    id: 'language',
    label: 'Language',
    options: [
      { value: '', label: 'Any language', hint: 'Applies to searches.' },
      { value: 'eng', label: 'English' },
      { value: 'fre', label: 'French' },
      { value: 'ger', label: 'German' },
      { value: 'spa', label: 'Spanish' },
      { value: 'hin', label: 'Hindi' },
      { value: 'jpn', label: 'Japanese' },
    ],
  },
  {
    id: 'sort',
    label: 'Sort',
    options: [
      { value: '', label: 'Most relevant', hint: 'Applies to searches.' },
      { value: 'new', label: 'Newest' },
      { value: 'old', label: 'Oldest' },
      { value: 'rating', label: 'Top rated' },
      { value: 'editions', label: 'Most editions' },
    ],
  },
];

function openLibrarySearchParams(f?: Record<string, string>): string {
  let s = '';
  if (f?.downloadable) s += '&has_fulltext=true';
  if (f?.language) s += `&language=${encodeURIComponent(f.language)}`;
  if (f?.sort) s += `&sort=${encodeURIComponent(f.sort)}`;
  return s;
}

/** "Free to download" keeps only titles this app can actually fetch. */
function keepDownloadable(items: CatalogEntry[], f?: Record<string, string>): CatalogEntry[] {
  return f?.downloadable ? items.filter((i) => (i.formats?.length ?? 0) > 0) : items;
}

export class OpenLibrarySource implements CatalogSource {
  id = 'openlibrary';
  name = 'Open Library';
  icon = 'BookOpen';
  kind = 'books' as const;
  filters = OPEN_LIBRARY_FILTERS;

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

  async browse(sectionId: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
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
        items: keepDownloadable(sliced.map(parseOpenLibraryDoc), filters),
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
    const url = `https://openlibrary.org/subjects/${subject}.json?limit=${limit}&offset=${offset}${
      filters?.downloadable ? '&ebooks=true' : ''
    }`;

    const data = await cachedJson<OpenLibrarySubjectResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Open Library subject error: ${res.statusText}`);
        return (await res.json()) as OpenLibrarySubjectResponse;
      },
      { freshMs: 60 * 60_000 },
    );

    const items = keepDownloadable((data.works || []).map(parseSubjectWork), filters);
    const hasMore = offset + limit < (data.work_count || 0);
    const next = hasMore ? String(offset + limit) : undefined;

    return { items, next };
  }

  async search(query: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
    const limit = 24;
    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query.trim())}&page=${page}&limit=${limit}&fields=key,title,author_name,cover_i,ebook_access,has_fulltext,id_project_gutenberg,ia,first_publish_year,subject,language${openLibrarySearchParams(filters)}`;

    const data = await cachedJson<OpenLibrarySearchResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Open Library search error: ${res.statusText}`);
        return (await res.json()) as OpenLibrarySearchResponse;
      },
      { freshMs: 30 * 60_000 },
    );

    const items = keepDownloadable((data.docs || []).map(parseOpenLibraryDoc), filters);
    const hasMore = page * limit < (data.numFound || 0);
    const next = hasMore ? String(page + 1) : undefined;

    return { items, next };
  }

  async details(id: string): Promise<CatalogEntry> {
    const rawId = id.replace(/^openlibrary:/, '');
    const workUrl = `https://openlibrary.org/works/${rawId}.json`;
    const searchUrl = `https://openlibrary.org/search.json?q=%2Fworks%2F${rawId}&fields=key,title,author_name,cover_i,ebook_access,has_fulltext,id_project_gutenberg,ia,first_publish_year,subject,language`;

    const [workData, searchData] = await Promise.all([
      cachedJson<OpenLibraryWorkDetail>(
        workUrl,
        async () => {
          const res = await net.fetch(workUrl);
          if (!res.ok) throw new Error(`Open Library details error: ${res.statusText}`);
          return (await res.json()) as OpenLibraryWorkDetail;
        },
        { freshMs: 6 * 60 * 60_000 },
      ).catch(() => null),
      cachedJson<OpenLibrarySearchResponse>(
        searchUrl,
        async () => {
          const res = await net.fetch(searchUrl);
          if (!res.ok) return { numFound: 0, start: 0, docs: [] };
          return (await res.json()) as OpenLibrarySearchResponse;
        },
        { freshMs: 6 * 60 * 60_000 },
      ).catch(() => null),
    ]);

    const doc = searchData?.docs?.[0];
    const title = workData?.title || doc?.title || 'Unknown Title';

    let summary = '';
    if (typeof workData?.description === 'string') {
      summary = workData.description;
    } else if (workData?.description && typeof workData.description === 'object' && 'value' in workData.description) {
      summary = workData.description.value;
    }

    const coverId = (workData?.covers && workData.covers.length > 0) ? workData.covers[0] : doc?.cover_i;
    const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined;

    const formats: CatalogFormat[] = [];
    if (doc?.id_project_gutenberg && doc.id_project_gutenberg.length > 0) {
      const gid = doc.id_project_gutenberg[0];
      formats.push({
        mime: 'application/epub+zip',
        url: `https://www.gutenberg.org/ebooks/${gid}.epub3.images`,
        label: 'Free EPUB (Project Gutenberg)',
      });
      formats.push({
        mime: 'application/epub+zip',
        url: `https://www.gutenberg.org/ebooks/${gid}.epub.noimages`,
        label: 'Free EPUB (Text only)',
      });
    } else if (doc?.ebook_access !== 'borrowable' && doc?.ebook_access !== 'printdisabled' && doc?.ia && doc.ia.length > 0) {
      const primaryIa = doc.ia[0];
      formats.push({
        mime: 'application/epub+zip',
        url: `https://archive.org/download/${primaryIa}/${primaryIa}.epub`,
        label: 'Free EPUB (Internet Archive)',
      });
    }

    return {
      id: `openlibrary:${rawId}`,
      title,
      authors: doc?.author_name || ['Unknown Author'],
      cover: coverUrl,
      summary,
      tags: workData?.subjects?.slice(0, 8) || doc?.subject?.slice(0, 8),
      formats,
      kind: 'book',
      year: doc?.first_publish_year,
    };
  }

  async download(
    entry: CatalogEntry,
    formatUrl: string,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const epubs = (entry.formats ?? []).filter((f) => f.mime === 'application/epub+zip');
    let chosenUrl = formatUrl || epubs[0]?.url;

    // 1. Direct Gutenberg download
    if (chosenUrl && chosenUrl.includes('gutenberg.org')) {
      onProgress?.(0.05);
      const blob = await net.download(chosenUrl, {
        onProgress: (p) => onProgress?.(0.05 + p * 0.9),
      });
      onProgress?.(1.0);
      const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
      return new File([blob], `${safeTitle}.epub`, {
        type: 'application/epub+zip',
      });
    }

    // 2. Internet Archive item with file discovery
    if (chosenUrl && chosenUrl.includes('archive.org/download/')) {
      const match = /archive\.org\/download\/([^/]+)/.exec(chosenUrl);
      const iaId = match ? match[1] : undefined;

      if (iaId) {
        try {
          // Resolve exact clean EPUB from metadata
          const metaRes = await net.fetch(`https://archive.org/metadata/${iaId}/files`);
          if (metaRes.ok) {
            const metaData = (await metaRes.json()) as { result?: Array<{ name: string; format?: string }> };
            const cleanEpub = (metaData.result || []).find(
              (f) => f.name.endsWith('.epub') && !f.name.endsWith('_lcp.epub') && !f.name.endsWith('_daisy.zip'),
            );
            if (cleanEpub) {
              chosenUrl = `https://archive.org/download/${iaId}/${cleanEpub.name}`;
            }
          }
        } catch {
          // Proceed with chosenUrl
        }
      }

      try {
        onProgress?.(0.05);
        const blob = await net.download(chosenUrl, {
          onProgress: (p) => onProgress?.(0.05 + p * 0.9),
        });
        onProgress?.(1.0);
        const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
        return new File([blob], `${safeTitle}.epub`, {
          type: 'application/epub+zip',
        });
      } catch (iaErr) {
        console.warn('Archive.org download failed, attempting Gutenberg fallback:', iaErr);
      }
    }

    // 3. Fallback: Search Project Gutenberg (Gutendex) for public domain title
    try {
      const gutendexUrl = `https://gutendex.com/books/?search=${encodeURIComponent(entry.title)}`;
      const gRes = await net.fetch(gutendexUrl);
      if (gRes.ok) {
        const gData = (await gRes.json()) as { results?: Array<{ formats?: Record<string, string> }> };
        const gMatch = gData.results?.[0];
        const gEpub = gMatch?.formats?.['application/epub+zip'];
        if (gEpub) {
          onProgress?.(0.1);
          const blob = await net.download(gEpub, {
            onProgress: (p) => onProgress?.(0.1 + p * 0.85),
          });
          onProgress?.(1.0);
          const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
          return new File([blob], `${safeTitle}.epub`, {
            type: 'application/epub+zip',
          });
        }
      }
    } catch {
      // ignore fallback error
    }

    throw new Error(
      `"${entry.title}" is in copyright or restricted for digital library borrowing on openlibrary.org. No public domain DRM-free EPUB is available.`,
    );
  }
}

export const openLibrarySource = new OpenLibrarySource();
