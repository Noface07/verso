// @ts-ignore
import { makeBook as rawMakeBook } from '../../vendor/foliate-js/view.js'
// @ts-ignore
import { Overlayer as RawOverlayer } from '../../vendor/foliate-js/overlayer.js'
// @ts-ignore
import * as RawCFI from '../../vendor/foliate-js/epubcfi.js'

export interface TocItem { label: string; href: string; subitems?: TocItem[] }
export interface SearchExcerpt { pre: string; match: string; post: string }
export interface SearchHit { cfi: string; excerpt: SearchExcerpt }
export type SearchEvent = 'done' | { progress: number } | { label?: string; subitems?: SearchHit[] }

export interface FoliateSection {
  linear?: string
  createDocument?: () => Promise<Document>
}

export interface FoliateBook {
  metadata?: Record<string, unknown>
  toc?: TocItem[]
  sections?: FoliateSection[]
  rendition?: { layout?: string }
  getCover?: () => Promise<Blob | null>
}

export interface OverlayerHandle {
  add(key: string, range: Range, draw: unknown, opts?: object): void
  remove(key: string): void
}

export interface FoliateRenderer extends HTMLElement {
  setStyles?: (css: string) => void
  scrollToAnchor?: (range: Range, select?: boolean) => unknown
  getContents?: () => { doc: Document; index: number; overlayer?: OverlayerHandle }[]
}

export interface FoliateTTS {
  start(): string | undefined
  resume(): string | undefined
  next(paused?: boolean): string | undefined
  prev(paused?: boolean): string | undefined
  from(range: Range): string | undefined
  setMark(name: string): void
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook
  renderer?: FoliateRenderer
  tts?: FoliateTTS
  open(file: File): Promise<void>
  init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number): Promise<unknown>
  goToFraction(fraction: number): Promise<void>
  goLeft(): void
  goRight(): void
  prev(): Promise<void>
  next(): Promise<void>
  getCFI(index: number, range: Range): string
  addAnnotation(annotation: { value: string } & Record<string, unknown>): Promise<unknown>
  deleteAnnotation(annotation: { value: string }): Promise<unknown>
  search(opts: {
    query: string
    matchCase?: boolean
    matchDiacritics?: boolean
    matchWholeWords?: boolean
  }): AsyncGenerator<SearchEvent>
  clearSearch(): void
  initTTS?(granularity?: string, highlight?: (range: Range) => void): Promise<void>
  close(): void
}

type DrawFn = unknown

export const makeBook = rawMakeBook as (file: File) => Promise<FoliateBook>
export const Overlayer = RawOverlayer as {
  highlight: DrawFn
  underline: DrawFn
  strikethrough: DrawFn
  squiggly: DrawFn
}
export const CFI = RawCFI as {
  collapse(cfi: string, toEnd?: boolean): string
  compare(a: string, b: string): number
}

export function compareCFI(a: string, b: string): number {
  try {
    return CFI.compare(a, b)
  } catch {
    return 0
  }
}