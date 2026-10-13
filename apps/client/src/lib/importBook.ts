import { db, type Book } from '../db'
import { makeBook, type FoliateBook } from './foliate'
import { sha256 } from './hash'

export const ACCEPT = '.epub,.mobi,.azw3,.azw,.fb2,.fbz,.cbz,.pdf'

const FORMATS: Record<string, string> = {
  epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', azw: 'AZW',
  fb2: 'FB2', fbz: 'FB2', cbz: 'CBZ', pdf: 'PDF',
}

function text(x: unknown): string {
  if (typeof x === 'string') return x.trim()
  if (Array.isArray(x)) return text(x[0])
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    if ('name' in o) return text(o.name)
    return text(Object.values(o)[0])
  }
  return ''
}

function people(x: unknown): string {
  const list = Array.isArray(x) ? x : x ? [x] : []
  return list.map(text).filter(Boolean).join(', ')
}

async function shrinkCover(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, 480 / bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.85))
  } catch {
    return blob
  }
}

export interface ImportResult {
  added: number
  skipped: number
  failed: { name: string; error: string }[]
}

export async function importFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = { added: 0, skipped: 0, failed: [] }
  for (const file of files) {
    try {
      if (await importOne(file)) result.added++
      else result.skipped++
    } catch (e) {
      result.failed.push({ name: file.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

async function importOne(file: File): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const hash = await sha256(await file.arrayBuffer())
  const existing = await db.books.get(hash)
  if (existing && !existing.deleted_at) return false

  const book = await makeBook(file)
  const md = book.metadata ?? {}

  let coverHash: string | null = null
  try {
    const cover = await book.getCover?.()
    if (cover) {
      const small = await shrinkCover(cover)
      coverHash = await sha256(await small.arrayBuffer())
      await db.covers.put({ id: hash, blob: small })
    }
  } catch {
    // some books ship broken cover images; fall back to a generated cover
  }

  await db.files.put({ hash, blob: file })

  const t = Date.now()
  const row: Book = {
    id: hash,
    title: text(md.title) || file.name.replace(/\.[^.]+$/, ''),
    author: people(md.author) || 'Unknown author',
    format: FORMATS[ext] ?? ext.toUpperCase(),
    file_hash: hash,
    file_size: file.size,
    cover_hash: coverHash,
    meta: {
      file_name: file.name,
      mime: file.type,
      language: text(md.language),
      publisher: people(md.publisher),
      description: text(md.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      series: text((md.belongsTo as Record<string, unknown> | undefined)?.series),
    },
    added_at: existing?.added_at ?? t,
    last_opened_at: existing?.last_opened_at ?? null,
    updated_at: t,
    deleted_at: null,
    _dirty: 1,
  }
  await db.books.put(row)
  void countText(hash, book, row.format)
  return true
}

async function countText(id: string, book: FoliateBook, format: string) {
  if (format === 'PDF' || format === 'CBZ' || book.rendition?.layout === 'pre-paginated') return
  let words = 0
  let paragraphs = 0
  for (const section of book.sections ?? []) {
    if (section.linear === 'no' || !section.createDocument) continue
    try {
      const doc = await section.createDocument()
      words += (doc.body?.textContent ?? '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
      paragraphs += doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, dd').length
    } catch {
      // skip unreadable sections
    }
    await new Promise((r) => setTimeout(r, 0))
  }
  const current = await db.books.get(id)
  if (current) {
    await db.books.put({
      ...current,
      meta: { ...current.meta, word_count: words, paragraph_count: paragraphs },
      updated_at: Date.now(),
      _dirty: 1,
    })
  }
}