import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db';
import {
  detectFontFormat,
  getCustomFonts,
  saveCustomFonts,
  importCustomFont,
  removeCustomFont,
  loadCustomFontFaceCSS,
  type CustomFontRecord,
} from '../src/lib/customFonts';
import {
  DEFAULT_SETTINGS,
  getEffectiveTheme,
  bookCSS,
  applyLayout,
  type ReaderSettings,
} from '../src/lib/readerSettings';
import { isFootnoteRef } from '../src/pages/Reader';
import { parseSSML, isSkippableTTSElement } from '../src/lib/tts';

describe('Phase 9: Reader Polish', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.files.clear();
  });

  afterEach(async () => {
    await db.settings.clear();
    await db.files.clear();
  });

  describe('P9.1 & P9.3: Theme & Advanced Typography Generation', () => {
    it('returns custom theme when theme is "custom"', () => {
      const settings: ReaderSettings = {
        ...DEFAULT_SETTINGS,
        theme: 'custom',
        customTheme: {
          name: 'My Emerald',
          bg: '#064e3b',
          fg: '#ecfdf5',
          link: '#34d399',
          dark: true,
          highlightOpacity: 0.4,
        },
      };

      const effective = getEffectiveTheme(settings);
      expect(effective.name).toBe('My Emerald');
      expect(effective.bg).toBe('#064e3b');
      expect(effective.fg).toBe('#ecfdf5');
      expect(effective.link).toBe('#34d399');
      expect(effective.dark).toBe(true);
    });

    it('injects advanced typography rules into bookCSS', () => {
      const settings: ReaderSettings = {
        ...DEFAULT_SETTINGS,
        paragraphSpacing: 16,
        firstLineIndent: 24,
        wordSpacing: 2,
        letterSpacing: 1,
        boldText: true,
        overridePublisher: true,
      };

      const css = bookCSS(settings);
      expect(css).toContain('margin-bottom: 16px !important');
      expect(css).toContain('text-indent: 24px !important');
      expect(css).toContain('word-spacing: 2px !important');
      expect(css).toContain('letter-spacing: 1px !important');
      expect(css).toContain('font-weight: 600 !important');
      expect(css).toContain('body *:not(a) { color: inherit !important; }');
    });

    it('configures foliate renderer attributes in applyLayout', () => {
      const mockAttributes: Record<string, string> = {};
      let stylesSet = '';
      const mockRenderer = {
        setAttribute: (k: string, v: string) => {
          mockAttributes[k] = v;
        },
        removeAttribute: (k: string) => {
          delete mockAttributes[k];
        },
        setStyles: (css: string) => {
          stylesSet = css;
        },
      } as unknown as Parameters<typeof applyLayout>[0];

      const settings: ReaderSettings = {
        ...DEFAULT_SETTINGS,
        flow: 'paginated',
        columns: 2,
        gap: 8,
        maxWidth: 800,
        pageAnimation: 'slide',
      };

      applyLayout(mockRenderer, settings);
      expect(mockAttributes['flow']).toBe('paginated');
      expect(mockAttributes['max-column-count']).toBe('2');
      expect(mockAttributes['gap']).toBe('8%');
      expect(mockAttributes['max-inline-size']).toBe('800px');
      expect(mockAttributes['animated']).toBe('');
      expect(stylesSet).toContain('line-height: 1.6 !important');
    });
  });

  describe('P9.2: Custom Fonts Engine', () => {
    it('detects font formats correctly from file extensions', () => {
      expect(detectFontFormat('my-font.woff2')).toBe('woff2');
      expect(detectFontFormat('my-font.woff')).toBe('woff');
      expect(detectFontFormat('my-font.otf')).toBe('opentype');
      expect(detectFontFormat('my-font.ttf')).toBe('truetype');
      expect(detectFontFormat('unknown.xyz')).toBe('truetype');
    });

    it('imports font file, stores blob in db.files, and saves metadata in db.settings', async () => {
      const fontContent = new Uint8Array([0, 1, 0, 0, 0, 12, 0, 0]); // dummy font bytes
      const file = new File([fontContent], 'CustomSerif.otf', { type: 'font/otf' });

      const record = await importCustomFont(file);
      expect(record.name).toBe('CustomSerif');
      expect(record.format).toBe('opentype');
      expect(record.fileName).toBe('CustomSerif.otf');

      // Check db.files
      const storedFile = await db.files.get(record.fileHash);
      expect(storedFile).toBeDefined();
      expect(storedFile?.blob).toBeDefined();

      // Check settings
      const fonts = await getCustomFonts();
      expect(fonts).toHaveLength(1);
      expect(fonts[0]?.fileHash).toBe(record.fileHash);
    });

    it('removes custom font from settings and revokes URLs', async () => {
      const font: CustomFontRecord = {
        id: 'font-test-123',
        name: 'TestFont',
        fileHash: 'abcdef123456',
        fileName: 'TestFont.woff2',
        format: 'woff2',
        addedAt: Date.now(),
      };

      await saveCustomFonts([font]);
      expect(await getCustomFonts()).toHaveLength(1);

      await removeCustomFont('font-test-123');
      expect(await getCustomFonts()).toHaveLength(0);
    });

    it('generates valid @font-face CSS rules from stored font files', async () => {
      const fontContent = new Uint8Array([1, 2, 3, 4]);
      const file = new File([fontContent], 'EBookFont.ttf', { type: 'font/ttf' });
      await importCustomFont(file);

      const css = await loadCustomFontFaceCSS();
      expect(css).toContain('@font-face');
      expect(css).toContain('font-family: "EBookFont"');
      expect(css).toContain('format("truetype")');
    });
  });

  describe('P9.4: Footnote & Link Detection', () => {
    it('detects footnote references via epub:type, role, and class', () => {
      const el1 = document.createElement('a');
      el1.setAttribute('epub:type', 'noteref');
      expect(isFootnoteRef(el1, '#note1')).toBe(true);

      const el2 = document.createElement('a');
      el2.setAttribute('role', 'doc-noteref');
      expect(isFootnoteRef(el2, '#ref123')).toBe(true);

      const el3 = document.createElement('a');
      el3.className = 'footnote-ref';
      expect(isFootnoteRef(el3, '#anything')).toBe(true);

      const el4 = document.createElement('a');
      const sup = document.createElement('sup');
      sup.appendChild(el4);
      expect(isFootnoteRef(el4, '')).toBe(true);
    });

    it('detects footnote references via href anchors', () => {
      const el = document.createElement('a');
      expect(isFootnoteRef(el, 'chapter1.xhtml#fn1')).toBe(true);
      expect(isFootnoteRef(el, '#note-42')).toBe(true);
      expect(isFootnoteRef(el, 'book.xhtml#footnote-3')).toBe(true);
    });

    it('returns false for standard internal navigation links', () => {
      const el = document.createElement('a');
      expect(isFootnoteRef(el, 'chapter2.xhtml#heading-1')).toBe(false);
      expect(isFootnoteRef(el, 'intro.html')).toBe(false);
    });
  });

  describe('P9.7: Read-Aloud SSML Parsing and Filtering', () => {
    it('identifies skippable footnote and page-number elements', () => {
      const noteref = document.createElement('a');
      noteref.setAttribute('epub:type', 'noteref');
      expect(isSkippableTTSElement(noteref)).toBe(true);

      const pagebreak = document.createElement('div');
      pagebreak.setAttribute('role', 'doc-pagebreak');
      expect(isSkippableTTSElement(pagebreak)).toBe(true);

      const supNumber = document.createElement('sup');
      supNumber.textContent = '[14]';
      expect(isSkippableTTSElement(supNumber)).toBe(true);

      const normalP = document.createElement('p');
      normalP.textContent = 'Normal paragraph text';
      expect(isSkippableTTSElement(normalP)).toBe(false);
    });

    it('skips footnote numbers and page breaks when parsing SSML for read-aloud', () => {
      const ssml = `
        <speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
          <s>It was the best of times<sup epub:type="noteref">1</sup>, it was the worst of times.</s>
          <div role="doc-pagebreak">Page 42</div>
          <s>It was the age of wisdom.</s>
        </speak>
      `;

      const result = parseSSML(ssml);
      expect(result.text).toContain('It was the best of times, it was the worst of times.');
      expect(result.text).toContain('It was the age of wisdom.');
      expect(result.text).not.toContain('Page 42');
      expect(result.text).not.toContain('1,');
      expect(result.lang).toBe('en');
    });
  });
});
