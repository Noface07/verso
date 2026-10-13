export interface CatalogFormat {
  mime: string;
  url: string;
  size?: number;
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
}

export interface CatalogPage {
  items: CatalogEntry[];
  next?: string;
}

export interface CatalogSection {
  id: string;
  title: string;
}

export interface CatalogSource {
  id: string;
  name: string;
  icon: string;
  kind: 'books' | 'manga';
  sections(): Promise<CatalogSection[]>;
  browse(sectionId: string, cursor?: string): Promise<CatalogPage>;
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
  pages(chapterId: string): Promise<PageRef[]>;
  credit?(chapter: ChapterInfo): string;
}
