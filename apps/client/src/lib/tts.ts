import { useEffect, useState } from 'react'
import { Overlayer, type FoliateTTS, type FoliateView } from './foliate'

export type TTSState = 'idle' | 'playing' | 'paused'
interface Mark { name: string; offset: number }

export function isSkippableTTSElement(el: Element): boolean {
  const epubType = el.getAttribute('epub:type') || el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''
  const role = el.getAttribute('role') || ''
  const cls = el.getAttribute('class') || ''
  if (epubType.includes('noteref') || epubType.includes('pagebreak')) return true
  if (role === 'doc-noteref' || role === 'doc-pagebreak') return true
  if (/(\bnoteref\b|\bfootnote-ref\b|\bpage-break\b|\bpage-number\b)/i.test(cls)) return true
  if (el.localName === 'sup' && /^\s*\[?\d+\]?\s*$/.test(el.textContent || '')) return true
  return false
}

export function parseSSML(ssml: string): { text: string; marks: Mark[]; lang?: string } {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml')
  let text = ''
  const marks: Mark[] = []
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { text += n.nodeValue ?? ''; return }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as Element
    if (isSkippableTTSElement(el)) return
    if (el.localName === 'mark') { marks.push({ name: el.getAttribute('name') ?? '', offset: text.length }); return }
    if (el.localName === 'break') { text += ' '; return }
    n.childNodes.forEach(walk)
  }
  walk(doc.documentElement)
  return { text, marks, lang: doc.documentElement.getAttribute('xml:lang') ?? undefined }
}

export class ReadAloud {
  state: TTSState = 'idle'
  rate = 1
  voiceURI = ''
  onState: ((s: TTSState) => void) | null = null
  private view: FoliateView
  private token = 0
  private section = 0

  constructor(view: FoliateView) {
    this.view = view
  }

  static supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  setSection(index: number) {
    this.section = index
  }

  private set(s: TTSState) {
    this.state = s
    this.onState?.(s)
  }

  private highlight = (range: Range) => {
    const r = this.view.renderer
    void r?.scrollToAnchor?.(range, true)
    const c = r?.getContents?.()[0]
    c?.overlayer?.remove('tts')
    c?.overlayer?.add('tts', range, Overlayer.highlight, { color: 'var(--accent)' })
  }

  private clearHighlight() {
    for (const c of this.view.renderer?.getContents?.() ?? []) c.overlayer?.remove('tts')
  }

  private halt(): number {
    this.token++
    if (ReadAloud.supported()) speechSynthesis.cancel()
    return this.token
  }

  private async prepare(): Promise<FoliateTTS> {
    if (!this.view.initTTS) throw new Error('Read aloud needs a newer foliate-js. Run "git pull" inside src/foliate-js.')
    await this.view.initTTS('word', this.highlight)
    if (!this.view.tts) throw new Error('Could not start read aloud.')
    return this.view.tts
  }

  async start(from?: Range | null) {
    if (!ReadAloud.supported()) throw new Error('No speech engine is available on this device.')
    const token = this.halt()
    const tts = await this.prepare()
    if (token !== this.token) return
    this.set('playing')
    let ssml: string | undefined
    try {
      ssml = from ? tts.from(from) : tts.start()
    } catch {
      ssml = tts.start()
    }
    void this.speak(ssml, token)
  }

  pause() {
    if (this.state !== 'playing') return
    this.halt()
    this.set('paused')
  }

  resume() {
    if (this.state === 'paused') this.continueWith((t) => t.resume())
  }

  toggle(from?: Range | null) {
    if (this.state === 'playing') {
      this.pause()
    } else if (this.state === 'paused') {
      this.resume()
    } else {
      void this.start(from)
    }
  }

  next() {
    if (this.state !== 'idle') this.continueWith((t) => t.next())
  }

  prev() {
    if (this.state !== 'idle') this.continueWith((t) => t.prev() ?? t.start())
  }

  restartBlock() {
    if (this.state === 'playing') this.continueWith((t) => t.resume())
  }

  stop() {
    this.halt()
    this.clearHighlight()
    this.set('idle')
  }

  private continueWith(get: (tts: FoliateTTS) => string | undefined) {
    const tts = this.view.tts
    if (!tts) return
    const token = this.halt()
    this.set('playing')
    void this.speak(get(tts), token)
  }

  private async speak(ssml: string | undefined, token: number): Promise<void> {
    if (token !== this.token) return

    if (!ssml) {
      const next = this.section + 1
      if (next >= (this.view.book.sections?.length ?? 0)) { this.stop(); return }
      try {
        await this.view.goTo(next)
        if (token !== this.token) return
        const tts = await this.prepare()
        if (token !== this.token) return
        return this.speak(tts.start(), token)
      } catch {
        this.stop()
        return
      }
    }

    const tts = this.view.tts
    if (!tts) return
    const { text, marks, lang } = parseSSML(ssml)
    if (!text.trim()) return this.speak(tts.next(), token)

    const u = new SpeechSynthesisUtterance(text)
    u.rate = this.rate
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === this.voiceURI)
    if (voice) u.voice = voice
    else if (lang) u.lang = lang

    if (marks[0]) tts.setMark(marks[0].name)
    u.onboundary = (e) => {
      if (token !== this.token) return
      let mark: Mark | undefined
      for (const m of marks) {
        if (m.offset <= e.charIndex) mark = m
        else break
      }
      if (mark) tts.setMark(mark.name)
    }
    u.onend = () => {
      if (token === this.token) void this.speak(tts.next(), token)
    }
    u.onerror = (e) => {
      if (token !== this.token || e.error === 'interrupted' || e.error === 'canceled') return
      this.stop()
    }
    speechSynthesis.speak(u)
  }
}

export function speakOnce(text: string, lang: string, voiceURI: string, rate: number) {
  if (!ReadAloud.supported()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI)
  if (v) u.voice = v
  else u.lang = lang
  u.rate = rate
  speechSynthesis.speak(u)
}

export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!ReadAloud.supported()) return
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])
  return voices
}