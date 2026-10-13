import JSZip from 'jszip';
import { db, type Book } from '../db';

/**
 * Exports multiple books as a ZIP file download.
 * Falls back to single file download if only 1 book is selected.
 */
export async function exportBooks(
  books: Book[],
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  if (books.length === 0) return;

  if (books.length === 1) {
    const book = books[0];
    const fileRow = await db.files.get(book.file_hash);
    if (!fileRow) {
      throw new Error(`File content for "${book.title}" is not available locally.`);
    }
    const filename = book.meta.file_name || `${book.title}.${book.format.toLowerCase()}`;
    downloadBlob(fileRow.blob, filename);
    return;
  }

  const zip = new JSZip();
  let done = 0;

  for (const book of books) {
    const fileRow = await db.files.get(book.file_hash);
    if (fileRow) {
      const filename = book.meta.file_name || `${book.title}.${book.format.toLowerCase()}`;
      // Prevent file collisions inside zip
      const safeName = `${book.id.slice(0, 6)}_${filename.replace(/[<>:"/\\|?*]/g, '_')}`;
      zip.file(safeName, fileRow.blob);
    }
    done++;
    onProgress?.(done, books.length);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadBlob(zipBlob, `folio-library-export-${timestamp}.zip`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
