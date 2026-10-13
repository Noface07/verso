import { net } from '../lib/net';
import { cachedJson } from '../lib/apiCache';
import type {
  CatalogEntry,
  CatalogFormat,
  CatalogPage,
  CatalogSection,
  CatalogSource,
} from './types';

interface ArchiveOrgDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
  description?: string | string[];
  year?: string | number;
  downloads?: number;
}

interface ArchiveOrgSearchResponse {
  response: {
    numFound: number;
    start: number;
    docs: ArchiveOrgDoc[];
  };
}

interface ArchiveOrgFile {
  name: string;
  format?: string;
  size?: string;
}

interface ArchiveOrgMetadataResponse {
  result?: ArchiveOrgFile[];
  files?: ArchiveOrgFile[];
  metadata?: {
    title?: string;
    creator?: string;
    description?: string;
    subject?: string | string[];
  };
}

function parseArchiveOrgDoc(doc: ArchiveOrgDoc): CatalogEntry {
  const authors: string[] = [];
  if (Array.isArray(doc.creator)) {
    authors.push(...doc.creator);
  } else if (doc.creator) {
    authors.push(doc.creator);
  } else {
    authors.push('Internet Archive Contributor');
  }

  let summary = '';
  if (Array.isArray(doc.description)) {
    summary = doc.description.join(' ');
  } else if (doc.description) {
    summary = doc.description;
  }

  const coverUrl = `https://archive.org/services/img/${doc.identifier}`;
  const formats: CatalogFormat[] = [
    {
      mime: 'application/epub+zip',
      url: `https://archive.org/download/${doc.identifier}/${doc.identifier}.epub`,
      label: 'Free EPUB',
    },
  ];

  return {
    id: `archiveorg:${doc.identifier}`,
    title: doc.title || doc.identifier,
    authors,
    cover: coverUrl,
    summary,
    formats,
    kind: 'book',
    year: typeof doc.year === 'number' ? doc.year : doc.year ? parseInt(String(doc.year), 10) : undefined,
  };
}

export class ArchiveOrgSource implements CatalogSource {
  id = 'archiveorg';
  name = 'Internet Archive';
  icon = 'BookOpen';
  kind = 'books' as const;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'popular', title: 'Most Popular' },
      { id: 'gutenberg', title: 'Gutenberg Archive' },
      { id: 'folkscanomy', title: 'Community Library' },
      { id: 'fiction', title: 'Fiction' },
      { id: 'history', title: 'History & Biographies' },
    ];
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const limit = 24;
    const page = cursor ? parseInt(cursor, 10) : 1;

    let filter = 'mediatype:texts AND format:EPUB';
    if (sectionId === 'gutenberg') {
      filter += ' AND collection:gutenberg';
    } else if (sectionId === 'folkscanomy') {
      filter += ' AND collection:folkscanomy';
    } else if (sectionId === 'fiction') {
      filter += ' AND subject:fiction';
    } else if (sectionId === 'history') {
      filter += ' AND subject:history';
    }

    const params = new URLSearchParams();
    params.set('q', filter);
    params.append('fl[]', 'identifier');
    params.append('fl[]', 'title');
    params.append('fl[]', 'creator');
    params.append('fl[]', 'description');
    params.append('fl[]', 'year');
    params.append('fl[]', 'downloads');
    params.set('sort[]', 'downloads desc');
    params.set('rows', String(limit));
    params.set('page', String(page));
    params.set('output', 'json');

    const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
    const data = await cachedJson<ArchiveOrgSearchResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Archive.org error: ${res.statusText}`);
        return (await res.json()) as ArchiveOrgSearchResponse;
      },
      { freshMs: 60 * 60_000 },
    );

    const items = (data.response?.docs || []).map(parseArchiveOrgDoc);
    const hasMore = page * limit < (data.response?.numFound || 0);
    const next = hasMore ? String(page + 1) : undefined;

    return { items, next };
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    const limit = 24;
    const page = cursor ? parseInt(cursor, 10) : 1;

    const safeQuery = query.replace(/[^\w\s-]/g, ' ').trim();
    const filter = `mediatype:texts AND format:EPUB AND (title:(${safeQuery}) OR creator:(${safeQuery}) OR description:(${safeQuery}))`;

    const params = new URLSearchParams();
    params.set('q', filter);
    params.append('fl[]', 'identifier');
    params.append('fl[]', 'title');
    params.append('fl[]', 'creator');
    params.append('fl[]', 'description');
    params.append('fl[]', 'year');
    params.append('fl[]', 'downloads');
    params.set('sort[]', 'downloads desc');
    params.set('rows', String(limit));
    params.set('page', String(page));
    params.set('output', 'json');

    const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
    const data = await cachedJson<ArchiveOrgSearchResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Archive.org search error: ${res.statusText}`);
        return (await res.json()) as ArchiveOrgSearchResponse;
      },
      { freshMs: 30 * 60_000 },
    );

    const items = (data.response?.docs || []).map(parseArchiveOrgDoc);
    const hasMore = page * limit < (data.response?.numFound || 0);
    const next = hasMore ? String(page + 1) : undefined;

    return { items, next };
  }

  async details(id: string): Promise<CatalogEntry> {
    const identifier = id.replace(/^archiveorg:/, '');
    const url = `https://archive.org/metadata/${identifier}`;

    const data = await cachedJson<ArchiveOrgMetadataResponse>(
      url,
      async () => {
        const res = await net.fetch(url);
        if (!res.ok) throw new Error(`Archive.org details error: ${res.statusText}`);
        return (await res.json()) as ArchiveOrgMetadataResponse;
      },
      { freshMs: 6 * 60 * 60_000 },
    );

    const meta = data.metadata || {};
    const files = data.files || data.result || [];
    const epubFile = files.find((f) => f.name.toLowerCase().endsWith('.epub'));

    const formats: CatalogFormat[] = [];
    if (epubFile) {
      formats.push({
        mime: 'application/epub+zip',
        url: `https://archive.org/download/${identifier}/${epubFile.name}`,
        label: 'Free EPUB',
        size: epubFile.size ? parseInt(epubFile.size, 10) : undefined,
      });
    } else {
      formats.push({
        mime: 'application/epub+zip',
        url: `https://archive.org/download/${identifier}/${identifier}.epub`,
        label: 'Free EPUB',
      });
    }

    const tags: string[] = [];
    if (Array.isArray(meta.subject)) {
      tags.push(...meta.subject.slice(0, 6));
    } else if (meta.subject) {
      tags.push(meta.subject);
    }

    return {
      id: `archiveorg:${identifier}`,
      title: meta.title || identifier,
      authors: meta.creator ? [meta.creator] : ['Internet Archive Contributor'],
      cover: `https://archive.org/services/img/${identifier}`,
      summary: meta.description,
      tags,
      formats,
      kind: 'book',
    };
  }

  async download(
    entry: CatalogEntry,
    formatUrl: string,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const identifier = entry.id.replace(/^archiveorg:/, '');
    let chosenUrl = formatUrl;

    if (!chosenUrl || !chosenUrl.endsWith('.epub')) {
      // Find actual epub filename via metadata
      try {
        const metaUrl = `https://archive.org/metadata/${identifier}`;
        const res = await net.fetch(metaUrl);
        if (res.ok) {
          const json = (await res.json()) as ArchiveOrgMetadataResponse;
          const files = json.files || json.result || [];
          const epub = files.find((f) => f.name.toLowerCase().endsWith('.epub'));
          if (epub) {
            chosenUrl = `https://archive.org/download/${identifier}/${epub.name}`;
          }
        }
      } catch {
        // Fallback to default constructed formatUrl
      }
    }

    chosenUrl = chosenUrl || `https://archive.org/download/${identifier}/${identifier}.epub`;

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
}

export const archiveOrgSource = new ArchiveOrgSource();
