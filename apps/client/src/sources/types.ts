export interface CatalogFormat {
  mime: string;
  url: string;
  size?: number;
  /** Human label when a source offers several editions of one format. */
  label?: string;
}

export interface CatalogEntry {
  id: string;
  title: string;
  authors: string[];
  cover?: string;
  summary?: string;
  languages?: string[];
  tags?: string[];
  formats?: CatalogFormat[];
  kind: 'book' | 'manga' | 'comic';
  /** Publication status, e.g. "ongoing", "completed". */
  status?: string;
  /** safe | suggestive | erotica | pornographic (MangaDex ratings). */
  contentRating?: string;
  year?: number;
  /** shounen, seinen, shoujo, josei. */
  demographic?: string;
}

/** Adult content ratings get an 18+ badge everywhere a title is shown. */
export const isAdultRating = (r?: string) => r === 'erotica' || r === 'pornographic';

export interface CatalogPage {
  items: CatalogEntry[];
  next?: string;
}

export interface CatalogSection {
  id: string;
  title: string;
}

/** A single-choice filter a source supports (empty value = any). */
export interface CatalogFilter {
  id: string;
  label: string;
  options: { value: string; label: string; /** Shown on hover. */ hint?: string }[];
}

export interface CatalogSource {
  id: string;
  name: string;
  icon: string;
  kind: 'books' | 'manga';
  /** Filters shown in the Store for this source; values are passed to browse/search. */
  filters?: CatalogFilter[];
  sections(): Promise<CatalogSection[]>;
  browse(sectionId: string, cursor?: string, filters?: Record<string, string>): Promise<CatalogPage>;
  search(
    query: string,
    cursor?: string,
    filters?: Record<string, string>,
  ): Promise<CatalogPage>;
  details(id: string): Promise<CatalogEntry>;
  download?(
    entry: CatalogEntry,
    format: string,
    onProgress?: (p: number) => void,
  ): Promise<File>;
}

export interface ChapterInfo {
  id: string;
  number?: number;
  title?: string;
  scanlationGroup?: string;
  publishedAt?: string;
  externalUrl?: string;
}

export interface PageRef {
  index: number;
  url: string;
}

export interface MangaSource extends CatalogSource {
  chapters(seriesId: string): Promise<ChapterInfo[]>;
  /** `dataSaver` asks for smaller images where the source offers them (thumbnails, mobile data). */
  pages(chapterId: string, dataSaver?: boolean): Promise<PageRef[]>;
  credit?(chapter: ChapterInfo): string;
}
