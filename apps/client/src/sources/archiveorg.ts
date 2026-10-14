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

  const isPeriodical =
    (doc.title && /magazine|periodical|issue|journal|comic/i.test(doc.title)) ||
    (doc.identifier && /magazine|comic/i.test(doc.identifier));

  const coverUrl = `https://archive.org/services/img/${doc.identifier}`;
  const formats: CatalogFormat[] = [];

  if (isPeriodical) {
    formats.push({
      mime: 'application/pdf',
      url: `https://archive.org/download/${doc.identifier}/${doc.identifier}.pdf`,
      label: 'Scanned Magazine (PDF with images)',
    });
    formats.push({
      mime: 'application/epub+zip',
      url: `https://archive.org/download/${doc.identifier}/${doc.identifier}.epub`,
      label: 'Text Only (OCR EPUB)',
    });
  } else {
    formats.push({
      mime: 'application/epub+zip',
      url: `https://archive.org/download/${doc.identifier}/${doc.identifier}.epub`,
      label: 'Free EPUB',
    });
    formats.push({
      mime: 'application/pdf',
      url: `https://archive.org/download/${doc.identifier}/${doc.identifier}.pdf`,
      label: 'Scanned Book (PDF with images)',
    });
  }

  return {
    id: `archiveorg:${doc.identifier}`,
    title: doc.title || doc.identifier,
    authors,
    cover: coverUrl,
    summary,
    formats,
    kind: isPeriodical ? 'comic' : 'book',
    year: typeof doc.year === 'number' ? doc.year : doc.year ? parseInt(String(doc.year), 10) : undefined,
  };
}

const ARCHIVE_LANGUAGES: [string, string][] = [
  ['eng', 'English'],
  ['fre', 'French'],
  ['ger', 'German'],
  ['spa', 'Spanish'],
  ['ita', 'Italian'],
  ['por', 'Portuguese'],
  ['rus', 'Russian'],
  ['hin', 'Hindi'],
  ['jpn', 'Japanese'],
  ['chi', 'Chinese'],
];

const ARCHIVE_FILTERS: CatalogFilter[] = [
  {
    id: 'sort',
    label: 'Sort',
    options: [
      { value: '', label: 'Most downloaded' },
      { value: 'addeddate desc', label: 'Recently added' },
      { value: 'date desc', label: 'Newest published' },
      { value: 'date asc', label: 'Oldest published' },
      { value: 'titleSorter asc', label: 'Title A–Z' },
    ],
  },
  {
    id: 'language',
    label: 'Language',
    options: [
      { value: '', label: 'Any language' },
      ...ARCHIVE_LANGUAGES.map(([value, label]) => ({ value, label })),
    ],
  },
  {
    id: 'format',
    label: 'Format',
    options: [
      { value: '', label: 'Any format' },
      { value: 'EPUB', label: 'EPUB' },
      { value: 'PDF', label: 'PDF' },
      { value: 'CBZ', label: 'Comic (CBZ)' },
    ],
  },
  {
    id: 'year',
    label: 'Published',
    options: [
      { value: '', label: 'Any year' },
      { value: '[* TO 1900]', label: 'Before 1900' },
      { value: '[1900 TO 1950]', label: '1900–1950' },
      { value: '[1950 TO 2000]', label: '1950–2000' },
      { value: '[2000 TO *]', label: '2000 onwards' },
    ],
  },
];

/** Extra clauses for the advancedsearch query from the Store filters. */
function archiveFilterQuery(f?: Record<string, string>): string {
  let q = '';
  if (f?.language) {
    const name = ARCHIVE_LANGUAGES.find(([code]) => code === f.language)?.[1];
    q += ` AND language:(${f.language}${name ? ` OR ${name}` : ''})`;
  }
  if (f?.format) q += ` AND format:${f.format}`;
  if (f?.year) q += ` AND year:${f.year}`;
  return q;
}

export class ArchiveOrgSource implements CatalogSource {
  id = 'archiveorg';
  name = 'Internet Archive';
  icon = 'BookOpen';
  kind = 'books' as const;
  filters = ARCHIVE_FILTERS;

  async sections(): Promise<CatalogSection[]> {
    return [
      { id: 'popular', title: 'Most Popular' },
      { id: 'magazines', title: 'Magazines & Periodicals' },
      { id: 'comics', title: 'Comics & Graphic Novels' },
      { id: 'gutenberg', title: 'Gutenberg Archive' },
      { id: 'folkscanomy', title: 'Community Library' },
      { id: 'fiction', title: 'Fiction' },
      { id: 'history', title: 'History & Biographies' },
    ];
  }

  async browse(sectionId: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
    const limit = 24;
    const page = cursor ? parseInt(cursor, 10) : 1;

    let filter = 'mediatype:texts AND -mediatype:collection AND (format:EPUB OR format:PDF OR format:CBZ)';
    if (sectionId === 'magazines') {
      filter = 'mediatype:texts AND -mediatype:collection AND (collection:magazine_rack OR collection:computermagazines OR subject:magazine OR subject:periodicals)';
    } else if (sectionId === 'comics') {
      filter = 'mediatype:texts AND -mediatype:collection AND (collection:comics OR collection:comicbooks OR subject:comics)';
    } else if (sectionId === 'gutenberg') {
      filter += ' AND collection:gutenberg';
    } else if (sectionId === 'folkscanomy') {
      filter += ' AND collection:folkscanomy';
    } else if (sectionId === 'fiction') {
      filter += ' AND subject:fiction';
    } else if (sectionId === 'history') {
      filter += ' AND subject:history';
    }
    filter += archiveFilterQuery(filters);

    const params = new URLSearchParams();
    params.set('q', filter);
    params.append('fl[]', 'identifier');
    params.append('fl[]', 'title');
    params.append('fl[]', 'creator');
    params.append('fl[]', 'description');
    params.append('fl[]', 'year');
    params.append('fl[]', 'downloads');
    params.set('sort[]', filters?.sort || 'downloads desc');
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

  async search(query: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage> {
    const limit = 24;
    const page = cursor ? parseInt(cursor, 10) : 1;

    const safeQuery = query.replace(/[^\w\s-]/g, ' ').trim();
    const filter = `mediatype:texts AND -mediatype:collection AND (format:EPUB OR format:PDF OR format:CBZ) AND (title:(${safeQuery}) OR creator:(${safeQuery}) OR description:(${safeQuery}))` + archiveFilterQuery(filters);

    const params = new URLSearchParams();
    params.set('q', filter);
    params.append('fl[]', 'identifier');
    params.append('fl[]', 'title');
    params.append('fl[]', 'creator');
    params.append('fl[]', 'description');
    params.append('fl[]', 'year');
    params.append('fl[]', 'downloads');
    params.set('sort[]', filters?.sort || 'downloads desc');
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

    // 1. PDF files (scanned magazines/books with images)
    const pdfFiles = files.filter(
      (f) =>
        f.name.toLowerCase().endsWith('.pdf') &&
        !f.name.toLowerCase().endsWith('_lcp.pdf') &&
        !f.name.toLowerCase().endsWith('_chocr.pdf'),
    );
    // Find best visual PDF (prefer clean non-_text and non-_bw PDF)
    const visualPdf =
      pdfFiles.find(
        (f) =>
          !f.name.toLowerCase().endsWith('_text.pdf') &&
          !f.name.toLowerCase().endsWith('_bw.pdf') &&
          !f.name.toLowerCase().endsWith('_daisy.pdf'),
      ) || pdfFiles[0];

    // 2. CBZ / Comic files
    const cbzFile = files.find(
      (f) =>
        f.name.toLowerCase().endsWith('.cbz') ||
        f.name.toLowerCase().endsWith('.cbr'),
    );

    // 3. Clean EPUB files (excluding DRM-locked _lcp.epub)
    const epubFile = files.find(
      (f) =>
        f.name.toLowerCase().endsWith('.epub') &&
        !f.name.toLowerCase().endsWith('_lcp.epub') &&
        !f.name.toLowerCase().endsWith('_daisy.zip'),
    );

    const isPeriodical =
      meta.subject?.toString().toLowerCase().includes('magazine') ||
      meta.subject?.toString().toLowerCase().includes('comic') ||
      meta.subject?.toString().toLowerCase().includes('periodical') ||
      meta.title?.toString().toLowerCase().includes('magazine') ||
      meta.description?.toString().toLowerCase().includes('magazine') ||
      Boolean(cbzFile);

    const formats: CatalogFormat[] = [];

    // For magazines & comics: prioritize visual scans with images (PDF / CBZ)
    if (isPeriodical || !epubFile) {
      if (visualPdf) {
        formats.push({
          mime: 'application/pdf',
          url: `https://archive.org/download/${identifier}/${visualPdf.name}`,
          label: 'Full Magazine Scan (PDF with images)',
          size: visualPdf.size ? parseInt(visualPdf.size, 10) : undefined,
        });
      }
      if (cbzFile) {
        formats.push({
          mime: 'application/vnd.comicbook+zip',
          url: `https://archive.org/download/${identifier}/${cbzFile.name}`,
          label: 'Comic / Scanned Pages (CBZ)',
          size: cbzFile.size ? parseInt(cbzFile.size, 10) : undefined,
        });
      }
      if (epubFile) {
        formats.push({
          mime: 'application/epub+zip',
          url: `https://archive.org/download/${identifier}/${epubFile.name}`,
          label: 'Text Only (OCR EPUB)',
          size: epubFile.size ? parseInt(epubFile.size, 10) : undefined,
        });
      }
    } else {
      // For general books: offer reflowable EPUB first, then original page scan PDF
      if (epubFile) {
        formats.push({
          mime: 'application/epub+zip',
          url: `https://archive.org/download/${identifier}/${epubFile.name}`,
          label: 'Free EPUB (Reflowable text)',
          size: epubFile.size ? parseInt(epubFile.size, 10) : undefined,
        });
      }
      if (visualPdf) {
        formats.push({
          mime: 'application/pdf',
          url: `https://archive.org/download/${identifier}/${visualPdf.name}`,
          label: 'Original Book Scan (PDF with images)',
          size: visualPdf.size ? parseInt(visualPdf.size, 10) : undefined,
        });
      }
      if (cbzFile) {
        formats.push({
          mime: 'application/vnd.comicbook+zip',
          url: `https://archive.org/download/${identifier}/${cbzFile.name}`,
          label: 'Comic / Scanned Pages (CBZ)',
          size: cbzFile.size ? parseInt(cbzFile.size, 10) : undefined,
        });
      }
    }

    if (formats.length === 0) {
      formats.push({
        mime: 'application/pdf',
        url: `https://archive.org/download/${identifier}/${identifier}.pdf`,
        label: 'Scanned PDF with images',
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
      kind: isPeriodical ? 'comic' : 'book',
    };
  }

  async download(
    entry: CatalogEntry,
    formatUrl: string,
    onProgress?: (p: number) => void,
  ): Promise<File> {
    const identifier = entry.id.replace(/^archiveorg:/, '');
    let chosenUrl = formatUrl;
    let chosenMime = 'application/epub+zip';
    let chosenExt = 'epub';

    const matchedFormat = entry.formats?.find((f) => f.url === formatUrl);
    if (matchedFormat) {
      chosenUrl = matchedFormat.url;
      chosenMime = matchedFormat.mime;
      if (chosenMime === 'application/pdf' || chosenUrl.toLowerCase().endsWith('.pdf')) {
        chosenExt = 'pdf';
        chosenMime = 'application/pdf';
      } else if (
        chosenMime.includes('comic') ||
        chosenUrl.toLowerCase().endsWith('.cbz')
      ) {
        chosenExt = 'cbz';
        chosenMime = 'application/vnd.comicbook+zip';
      }
    } else if (!chosenUrl) {
      const first = entry.formats?.[0];
      if (first) {
        chosenUrl = first.url;
        chosenMime = first.mime;
        if (chosenMime === 'application/pdf' || chosenUrl.toLowerCase().endsWith('.pdf')) {
          chosenExt = 'pdf';
          chosenMime = 'application/pdf';
        } else if (chosenMime.includes('comic') || chosenUrl.toLowerCase().endsWith('.cbz')) {
          chosenExt = 'cbz';
          chosenMime = 'application/vnd.comicbook+zip';
        }
      }
    }

    // If chosenUrl has no extension or is generic, resolve actual filename via metadata
    if (
      !chosenUrl ||
      (!chosenUrl.endsWith('.pdf') && !chosenUrl.endsWith('.epub') && !chosenUrl.endsWith('.cbz'))
    ) {
      try {
        const metaUrl = `https://archive.org/metadata/${identifier}`;
        const res = await net.fetch(metaUrl);
        if (res.ok) {
          const json = (await res.json()) as ArchiveOrgMetadataResponse;
          const files = json.files || json.result || [];
          const pdf = files.find(
            (f) =>
              f.name.toLowerCase().endsWith('.pdf') &&
              !f.name.toLowerCase().endsWith('_text.pdf'),
          );
          const epub = files.find((f) => f.name.toLowerCase().endsWith('.epub'));

          if (pdf && (!epub || chosenExt === 'pdf' || entry.title.toLowerCase().includes('magazine'))) {
            chosenUrl = `https://archive.org/download/${identifier}/${pdf.name}`;
            chosenExt = 'pdf';
            chosenMime = 'application/pdf';
          } else if (epub) {
            chosenUrl = `https://archive.org/download/${identifier}/${epub.name}`;
            chosenExt = 'epub';
            chosenMime = 'application/epub+zip';
          }
        }
      } catch {
        // Fallback
      }
    }

    chosenUrl = chosenUrl || `https://archive.org/download/${identifier}/${identifier}.${chosenExt}`;

    onProgress?.(0.05);
    const blob = await net.download(chosenUrl, {
      onProgress: (p) => onProgress?.(0.05 + p * 0.9),
    });
    onProgress?.(1.0);

    const safeTitle = entry.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    return new File([blob], `${safeTitle}.${chosenExt}`, {
      type: chosenMime,
    });
  }
}

export const archiveOrgSource = new ArchiveOrgSource();
