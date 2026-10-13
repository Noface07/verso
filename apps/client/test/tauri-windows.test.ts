import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db';
import {
  IndexedDbBlobStore,
  FsBlobStore,
  getBlobStore,
  migrateBlobsToFs,
} from '../src/lib/blobStore';
import {
  isSupportedBookFile,
  SUPPORTED_DESKTOP_EXTENSIONS,
  handleDeepLinkUrl,
} from '../src/lib/tauriIntegration';
import {
  isTauri,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  openExternalUrl,
} from '../src/lib/tauri';

describe('Phase 10: Desktop App (Tauri Windows)', () => {
  beforeEach(async () => {
    await db.files.clear();
    await db.books.clear();
  });

  afterEach(async () => {
    await db.files.clear();
    await db.books.clear();
  });

  describe('P10.3: BlobStore Abstraction & Storage', () => {
    it('IndexedDbBlobStore puts, gets, checks, and deletes blobs', async () => {
      const store = new IndexedDbBlobStore();
      const testBlob = new Blob(['sample-epub-content'], { type: 'application/epub+zip' });
      const hash = 'hash-test-12345';

      expect(await store.has(hash)).toBe(false);
      expect(await store.get(hash)).toBeNull();

      await store.put(hash, testBlob);
      expect(await store.has(hash)).toBe(true);

      const retrieved = await store.get(hash);
      expect(retrieved).toBeDefined();

      await store.delete(hash);
      expect(await store.has(hash)).toBe(false);
      expect(await store.get(hash)).toBeNull();
    });

    it('FsBlobStore falls back gracefully to IndexedDB in test environment', async () => {
      const fsStore = new FsBlobStore();
      const testBlob = new Blob(['desktop-content'], { type: 'application/epub+zip' });
      const hash = 'hash-fs-fallback-789';

      await fsStore.put(hash, testBlob);
      expect(await fsStore.has(hash)).toBe(true);

      const retrieved = await fsStore.get(hash);
      expect(retrieved).toBeDefined();

      await fsStore.delete(hash);
      expect(await fsStore.has(hash)).toBe(false);
    });

    it('getBlobStore returns a valid singleton store', () => {
      const store = getBlobStore();
      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
      expect(typeof store.put).toBe('function');
      expect(typeof store.has).toBe('function');
      expect(typeof store.delete).toBe('function');
    });

    it('migrateBlobsToFs safely runs without errors in web fallback', async () => {
      await db.files.put({
        hash: 'hash-mig-1',
        blob: new Blob(['file 1']),
      });
      await db.files.put({
        hash: 'hash-mig-2',
        blob: new Blob(['file 2']),
      });

      const progressSpy = vi.fn();
      const result = await migrateBlobsToFs(progressSpy);

      expect(result).toBeDefined();
      expect(typeof result.migrated).toBe('number');
      expect(typeof result.total).toBe('number');
    });
  });

  describe('P10.4: File Associations and Supported Formats', () => {
    it('supports all required desktop book and comic file extensions', () => {
      const required = [
        '.epub',
        '.mobi',
        '.azw3',
        '.azw',
        '.fb2',
        '.fbz',
        '.cbz',
        '.cbr',
        '.cb7',
        '.pdf',
      ];

      for (const ext of required) {
        expect(SUPPORTED_DESKTOP_EXTENSIONS).toContain(ext);
        expect(isSupportedBookFile(`C:\\Users\\Reader\\Books\\mybook${ext}`)).toBe(true);
        expect(isSupportedBookFile(`/home/user/books/sample${ext.toUpperCase()}`)).toBe(true);
      }
    });

    it('rejects unsupported file formats', () => {
      expect(isSupportedBookFile('file.txt')).toBe(false);
      expect(isSupportedBookFile('document.docx')).toBe(false);
      expect(isSupportedBookFile('setup.exe')).toBe(false);
      expect(isSupportedBookFile('image.png')).toBe(false);
    });

    it('routes deep links correctly', async () => {
      const navigate = vi.fn();

      await handleDeepLinkUrl('folio://reader/book-abc-123', navigate);
      expect(navigate).toHaveBeenCalledWith('/reader/book-abc-123');

      navigate.mockClear();
      await handleDeepLinkUrl('folio://book/series-xyz-789', navigate);
      expect(navigate).toHaveBeenCalledWith('/book/series-xyz-789');

      navigate.mockClear();
      await handleDeepLinkUrl('folio://open?id=my-book-id', navigate);
      expect(navigate).toHaveBeenCalledWith('/reader/my-book-id');

      navigate.mockClear();
      await handleDeepLinkUrl('https://example.com', navigate);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('P10.1 & P10.5: Window Controls & Degradation', () => {
    it('isTauri returns false in normal web and test environment', () => {
      expect(isTauri()).toBe(false);
    });

    it('window control functions no-op gracefully without throwing outside Tauri', async () => {
      await expect(minimizeWindow()).resolves.toBeUndefined();
      await expect(toggleMaximizeWindow()).resolves.toBeUndefined();
      await expect(closeWindow()).resolves.toBeUndefined();
    });

    it('openExternalUrl falls back to window.open in web environment', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      await openExternalUrl('https://standardebooks.org');
      expect(openSpy).toHaveBeenCalledWith('https://standardebooks.org', '_blank', 'noopener,noreferrer');
      openSpy.mockRestore();
    });
  });
});
