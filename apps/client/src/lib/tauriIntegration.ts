import { isTauri, listenFileOpen, listenDeepLink } from './tauri';
import { importOne } from './importBook';
import { db } from '../db';

export const SUPPORTED_DESKTOP_EXTENSIONS = [
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

export function isSupportedBookFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SUPPORTED_DESKTOP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Handles an incoming file path from single instance CLI arguments or file association double-clicks.
 */
export async function handleOpenedFile(
  filePath: string,
  onOpenBook?: (bookId: string) => void,
): Promise<string | null> {
  if (!isSupportedBookFile(filePath)) return null;

  try {
    let file: File;
    if (isTauri()) {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(filePath);
      const fileName = filePath.replace(/\\/g, '/').split('/').pop() || 'book.epub';
      file = new File([bytes], fileName);
    } else {
      return null;
    }

    // Import the book into database
    await importOne(file);
    const { sha256 } = await import('./hash');
    const bookId = await sha256(await file.arrayBuffer());

    // Call callback or navigate
    if (onOpenBook && bookId) {
      onOpenBook(bookId);
    }

    return bookId;
  } catch (err) {
    console.error('Failed to open file association:', filePath, err);
    return null;
  }
}

/**
 * Parses deep link URL and routes appropriately.
 */
export async function handleDeepLinkUrl(
  urlStr: string,
  onNavigate?: (path: string) => void,
): Promise<void> {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'folio:') return;

    // In WHATWG URL parsing for folio://reader/123:
    // parsed.host is 'reader', parsed.pathname is '/123'
    // For folio:///reader/123:
    // parsed.host is '', parsed.pathname is '/reader/123'
    const fullPath = (parsed.host ? `/${parsed.host}` : '') + parsed.pathname;

    if (fullPath.startsWith('/reader/')) {
      const bookId = fullPath.replace(/^\/reader\//, '');
      if (bookId) {
        onNavigate?.(`/reader/${bookId}`);
        return;
      }
    }

    if (fullPath.startsWith('/book/')) {
      const bookId = fullPath.replace(/^\/book\//, '');
      if (bookId) {
        onNavigate?.(`/book/${bookId}`);
        return;
      }
    }

    const idParam = parsed.searchParams.get('id');
    if (idParam) {
      onNavigate?.(`/reader/${idParam}`);
      return;
    }

    const hashParam = parsed.searchParams.get('hash');
    if (hashParam) {
      const book = await db.books.where('file_hash').equals(hashParam).first();
      if (book) {
        onNavigate?.(`/reader/${book.id}`);
      }
    }
  } catch (err) {
    console.warn('Failed to parse deep link URL:', urlStr, err);
  }
}

/**
 * Initializes Tauri desktop listeners for file associations and deep links.
 */
export function initTauriDesktopIntegration(
  onNavigate: (path: string) => void,
): () => void {
  if (!isTauri()) return () => {};

  let cleanupFileOpen = () => {};
  let cleanupDeepLink = () => {};

  void listenFileOpen((filePath) => {
    void handleOpenedFile(filePath, (bookId) => {
      onNavigate(`/reader/${bookId}`);
    });
  }).then((cleanup) => {
    cleanupFileOpen = cleanup;
  });

  void listenDeepLink((url) => {
    void handleDeepLinkUrl(url, onNavigate);
  }).then((cleanup) => {
    cleanupDeepLink = cleanup;
  });

  return () => {
    cleanupFileOpen();
    cleanupDeepLink();
  };
}
