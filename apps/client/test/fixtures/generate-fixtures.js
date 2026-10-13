import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(0, 8);           // compression: 0 (store)
    lh.writeUInt16LE(0, 10);          // mod time
    lh.writeUInt16LE(0, 12);          // mod date
    lh.writeUInt32LE(crc, 14);        // crc-32
    lh.writeUInt32LE(size, 18);       // compressed size
    lh.writeUInt32LE(size, 22);       // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);          // extra field length
    nameBuf.copy(lh, 30);

    localHeaders.push(lh, data);

    // Central directory header
    const ch = Buffer.alloc(46 + nameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0); // signature
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0, 8);           // flags
    ch.writeUInt16LE(0, 10);          // compression
    ch.writeUInt16LE(0, 12);          // mod time
    ch.writeUInt16LE(0, 14);          // mod date
    ch.writeUInt32LE(crc, 16);        // crc-32
    ch.writeUInt32LE(size, 20);       // compressed size
    ch.writeUInt32LE(size, 24);       // uncompressed size
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra length
    ch.writeUInt16LE(0, 32);          // comment length
    ch.writeUInt16LE(0, 34);          // disk number start
    ch.writeUInt16LE(0, 36);          // internal attributes
    ch.writeUInt32LE(0, 38);          // external attributes
    ch.writeUInt32LE(offset, 42);     // relative offset of local header
    nameBuf.copy(ch, 46);

    centralHeaders.push(ch);
    offset += lh.length + data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // disk where central dir starts
  eocd.writeUInt16LE(centralHeaders.length, 8); // entries on disk
  eocd.writeUInt16LE(centralHeaders.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);        // size of central dir
  eocd.writeUInt32LE(centralDirOffset, 16);      // offset of central dir
  eocd.writeUInt16LE(0, 20);          // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

// 1. EPUB 2
const epub2 = createZip({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'OEBPS/content.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample EPUB 2 Book</dc:title><dc:creator>Project Gutenberg</dc:creator><dc:identifier id="bookid">urn:uuid:12345</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="ch1"/></spine></package>',
  'OEBPS/toc.ncx': '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:12345"/></head><docTitle><text>Sample EPUB 2</text></docTitle><navMap><navPoint id="np1" playOrder="1"><navLabel><text>Chapter 1</text></navLabel><content src="ch1.xhtml"/></navPoint></navMap></ncx>',
  'OEBPS/ch1.xhtml': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p>This is a sample EPUB 2 paragraph.</p></body></html>',
});
fs.writeFileSync(path.join(__dirname, 'sample-epub2.epub'), epub2);

// 2. EPUB 3
const epub3 = createZip({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'EPUB/package.opf': '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:epub3-sample</dc:identifier><dc:title>Sample EPUB 3</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-13T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>',
  'EPUB/nav.xhtml': '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head><body><nav epub:type="toc"><h1>TOC</h1><ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol></nav></body></html>',
  'EPUB/ch1.xhtml': '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p>This is an EPUB 3 test chapter.</p></body></html>',
});
fs.writeFileSync(path.join(__dirname, 'sample-epub3.epub'), epub3);

// 3. Arabic RTL EPUB 3
const arabicEpub = createZip({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'EPUB/package.opf': '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" page-progression-direction="rtl"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:arabic-sample</dc:identifier><dc:title>Arabic RTL Sample</dc:title><dc:language>ar</dc:language><meta property="dcterms:modified">2026-10-13T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="rtl"><itemref idref="ch1"/></spine></package>',
  'EPUB/nav.xhtml': '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" dir="rtl"><head><title>Index</title></head><body dir="rtl"><nav epub:type="toc"><h1>Index</h1><ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol></nav></body></html>',
  'EPUB/ch1.xhtml': '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" dir="rtl"><head><title>Chapter 1</title></head><body dir="rtl"><h1>Chapter 1</h1><p>Arabic sample text.</p></body></html>',
});
fs.writeFileSync(path.join(__dirname, 'sample-arabic-rtl.epub'), arabicEpub);

// 4. Japanese Vertical EPUB 3
const japaneseEpub = createZip({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'EPUB/package.opf': '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" page-progression-direction="rtl"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:japanese-sample</dc:identifier><dc:title>Japanese Vertical Sample</dc:title><dc:language>ja</dc:language><meta property="dcterms:modified">2026-10-13T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="rtl"><itemref idref="ch1"/></spine></package>',
  'EPUB/nav.xhtml': '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Index</title></head><body><nav epub:type="toc"><h1>Index</h1><ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol></nav></body></html>',
  'EPUB/ch1.xhtml': '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title><style>html { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; }</style></head><body><h1>Chapter 1</h1><p>Japanese vertical text sample.</p></body></html>',
});
fs.writeFileSync(path.join(__dirname, 'sample-japanese-vertical.epub'), japaneseEpub);

// 5. 20-page CBZ
const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

const cbzFiles = {};
for (let i = 1; i <= 20; i++) {
  const num = String(i).padStart(2, '0');
  cbzFiles[`page_${num}.png`] = pngBytes;
}
const cbz = createZip(cbzFiles);
fs.writeFileSync(path.join(__dirname, 'sample-comic.cbz'), cbz);

console.log('Successfully generated test fixtures.');
