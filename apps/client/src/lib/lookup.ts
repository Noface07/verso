export interface DictSense { html: string; examples: string[] }
export interface DictGroup { partOfSpeech: string; senses: DictSense[] }
export interface DictResult {
  word: string
  phonetic?: string
  audio?: string
  groups: DictGroup[]
  source: 'Wiktionary' | 'Free Dictionary'
}
export interface WikiResult { title: string; extract: string; thumbnail?: string; url: string }

export const LANGUAGES: [string, string][] = [
  ['hi', 'Hindi'], ['en', 'English'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'],
  ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'],
  ['ur', 'Urdu'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['ru', 'Russian'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['zh-CN', 'Chinese (Simplified)'], ['ar', 'Arabic'],
]

export const langName = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code.toUpperCase()
export const baseLang = (lang?: string) => (lang || 'en').toLowerCase().split(/[-_]/)[0] || 'en'
export const cleanWord = (s: string) => s.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e }))
  return cache.get(key) as Promise<T>
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function wiktionary(word: string, lang: string): Promise<DictResult | null> {
  const terms = [...new Set([word, word.toLowerCase()])]
  for (const term of terms) {
    const r = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`)
    if (!r.ok) continue
    const data = (await r.json()) as Record<string, {
      partOfSpeech: string
      definitions: { definition: string; examples?: string[] }[]
    }[]>
    const list = data[lang] ?? data.en ?? Object.values(data)[0]
    if (!list?.length) continue
    const groups = list
      .map((g) => ({
        partOfSpeech: g.partOfSpeech,
        senses: g.definitions
          .filter((d) => d.definition?.trim())
          .slice(0, 6)
          .map((d) => ({ html: d.definition, examples: (d.examples ?? []).slice(0, 1) })),
      }))
      .filter((g) => g.senses.length)
    if (groups.length) return { word: term, groups, source: 'Wiktionary' }
  }
  return null
}

async function freeDictionary(word: string): Promise<DictResult | null> {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`)
  if (!r.ok) return null
  const data = (await r.json()) as {
    word: string
    phonetic?: string
    phonetics?: { text?: string; audio?: string }[]
    meanings?: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
  }[]
  let phonetic: string | undefined
  let audio: string | undefined
  const groups: DictGroup[] = []
  for (const e of data) {
    phonetic ??= e.phonetic || e.phonetics?.find((p) => p.text)?.text
    audio ??= e.phonetics?.find((p) => p.audio)?.audio || undefined
    for (const m of e.meanings ?? []) {
      groups.push({
        partOfSpeech: m.partOfSpeech,
        senses: m.definitions.slice(0, 5).map((d) => ({
          html: escapeHtml(d.definition),
          examples: d.example ? [escapeHtml(d.example)] : [],
        })),
      })
    }
  }
  return groups.length ? { word: data[0]?.word ?? word, phonetic, audio, groups, source: 'Free Dictionary' } : null
}

export function define(word: string, lang?: string): Promise<DictResult | null> {
  const w = cleanWord(word)
  const l = baseLang(lang)
  return cached(`d:${l}:${w}`, async () => {
    const [wk, fd] = await Promise.all([
      wiktionary(w, l).catch(() => null),
      l === 'en' ? freeDictionary(w).catch(() => null) : Promise.resolve(null),
    ])
    if (wk) return { ...wk, phonetic: fd?.phonetic, audio: fd?.audio }
    return fd
  })
}

export function wikipedia(term: string, lang?: string): Promise<WikiResult | null> {
  const l = baseLang(lang)
  const title = cleanWord(term).replace(/\s+/g, '_')
  return cached(`w:${l}:${title}`, async () => {
    const r = await fetch(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`)
    if (!r.ok) return null
    const d = await r.json()
    if (!d.extract) return null
    return {
      title: d.title,
      extract: d.extract,
      thumbnail: d.thumbnail?.source,
      url: d.content_urls?.desktop?.page ?? `https://${l}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    }
  })
}

function decodeEntities(s: string) {
  const t = document.createElement('textarea')
  t.innerHTML = s
  return t.value
}

export function translate(text: string, from: string, to: string): Promise<string> {
  const src = baseLang(from)
  if (src === baseLang(to)) return Promise.resolve(text)
  const q = text.trim().slice(0, 500)
  return cached(`t:${src}:${to}:${q}`, async () => {
    const r = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(`${src}|${to}`)}`,
    )
    if (!r.ok) throw new Error(`Translation service error (${r.status})`)
    const d = await r.json()
    const out: string = d?.responseData?.translatedText ?? ''
    if (String(d?.responseStatus) !== '200' || /MYMEMORY WARNING|LIMIT/i.test(out)) {
      throw new Error(out ? decodeEntities(out) : 'Translation is unavailable right now.')
    }
    return decodeEntities(out)
  })
}