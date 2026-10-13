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

/** fetch + JSON with a hard timeout, so a hung service fails fast instead of spinning forever. */
async function getJson<T>(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; data?: T }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) return { ok: false, status: r.status }
  return { ok: true, status: r.status, data: (await r.json()) as T }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type WiktionaryResponse = Record<string, {
  partOfSpeech: string
  definitions: { definition: string; examples?: string[] }[]
}[]>

async function wiktionary(word: string, lang: string): Promise<DictResult | null> {
  // A capitalised word (e.g. at the start of a sentence) usually only has an entry in
  // lower case. Ask for both spellings at once instead of waiting for a 404 first.
  const terms = [...new Set([word, word.toLowerCase()])]
  const responses = await Promise.all(
    terms.map((term) =>
      getJson<WiktionaryResponse>(
        `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`,
        8000,
      ).catch(() => null),
    ),
  )
  for (const [i, term] of terms.entries()) {
    const data = responses[i]?.data
    if (!data) continue
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

// dictionaryapi.dev regularly goes down by hanging ~20s and then returning 522. After
// one timeout/5xx, skip it for a while instead of making every lookup wait on it again.
const FREE_DICT_COOLDOWN_MS = 10 * 60_000
let freeDictDownUntil = 0

interface FreeDictEntry {
  word: string
  phonetic?: string
  phonetics?: { text?: string; audio?: string }[]
  meanings?: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

async function freeDictionary(word: string): Promise<DictResult | null> {
  if (Date.now() < freeDictDownUntil) return null
  let res: Awaited<ReturnType<typeof getJson<FreeDictEntry[]>>>
  try {
    res = await getJson<FreeDictEntry[]>(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      5000,
    )
  } catch {
    freeDictDownUntil = Date.now() + FREE_DICT_COOLDOWN_MS
    return null
  }
  if (res.status >= 500) freeDictDownUntil = Date.now() + FREE_DICT_COOLDOWN_MS
  if (!res.data) return null
  const data = res.data
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

const freeDictCached = (w: string) =>
  cached(`fd:${w.toLowerCase()}`, () => freeDictionary(w).catch(() => null))

/**
 * Definitions. Resolves as soon as Wiktionary answers; it no longer waits for the
 * Free Dictionary request (which only adds pronunciation and can take ~20s when that
 * service is struggling). Free Dictionary is awaited only as a fallback when
 * Wiktionary has nothing. Use `pronunciation()` to fill in phonetics/audio later.
 */
export function define(word: string, lang?: string): Promise<DictResult | null> {
  const w = cleanWord(word)
  const l = baseLang(lang)
  return cached(`d:${l}:${w}`, async () => {
    const fd = l === 'en' ? freeDictCached(w) : Promise.resolve(null)
    const wk = await wiktionary(w, l).catch(() => null)
    if (wk) return wk
    return fd
  })
}

/** Phonetic spelling and audio for an English word (may resolve after the definition). */
export function pronunciation(word: string, lang?: string): Promise<{ phonetic?: string; audio?: string } | null> {
  if (baseLang(lang) !== 'en') return Promise.resolve(null)
  return freeDictCached(cleanWord(word)).then((fd) =>
    fd && (fd.phonetic || fd.audio) ? { phonetic: fd.phonetic, audio: fd.audio } : null,
  )
}

export function wikipedia(term: string, lang?: string): Promise<WikiResult | null> {
  const l = baseLang(lang)
  const title = cleanWord(term).replace(/\s+/g, '_')
  return cached(`w:${l}:${title}`, async () => {
    const { data: d } = await getJson<{
      title: string
      extract?: string
      thumbnail?: { source: string }
      content_urls?: { desktop?: { page?: string } }
    }>(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`, 8000)
    if (!d) return null
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
      { signal: AbortSignal.timeout(10000) },
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