import { db, dirty, type DownloadItem } from '../../db';
import { importOne } from '../../lib/importBook';
import type { CatalogEntry, CatalogSource } from '../../sources/types';

class DownloadManager {
  private activeControllers = new Map<string, AbortController>();

  async enqueue(
    entry: CatalogEntry,
    source: CatalogSource,
    formatMime = 'application/epub+zip',
  ): Promise<string> {
    const downloadId = `dl:${entry.id}`;
    // `formatMime` may also be a specific format URL (e.g. one edition of several).
    const format =
      entry.formats?.find((f) => f.url === formatMime) ||
      entry.formats?.find((f) => f.mime === formatMime) ||
      entry.formats?.[0];
    const url = format?.url || '';

    const existing = await db.downloads.get(downloadId);
    if (existing && (existing.status === 'downloading' || existing.status === 'completed')) {
      return downloadId;
    }

    const item: DownloadItem = {
      id: downloadId,
      kind: entry.kind === 'manga' ? 'manga' : 'book',
      source: source.id,
      title: entry.title,
      url,
      status: 'pending',
      progress: 0,
      created_at: Date.now(),
      entry: entry as unknown as Record<string, unknown>,
    };

    await db.downloads.put(item);
    void this.process(downloadId, entry, source, formatMime);
    return downloadId;
  }

  async process(
    downloadId: string,
    entry: CatalogEntry,
    source: CatalogSource,
    formatMime: string,
  ): Promise<void> {
    const abortCtrl = new AbortController();
    this.activeControllers.set(downloadId, abortCtrl);

    try {
      await db.downloads.update(downloadId, {
        status: 'downloading',
        progress: 0.1,
      });

      if (!source.download) {
        throw new Error(`Source "${source.name}" does not support downloads.`);
      }

      const file = await source.download(entry, formatMime, async (p) => {
        await db.downloads.update(downloadId, {
          progress: Math.min(0.9, Math.max(0.1, p)),
        });
      });

      // Import downloaded file into library
      try {
        await importOne(file);
      } catch (err) {
        console.warn('Import failed for downloaded file:', err);
      }

      // Tag imported book with meta.source
      const targetBook = await db.books
        .filter(
          (b) =>
            !b.deleted_at &&
            (b.title.toLowerCase() === entry.title.toLowerCase() ||
              b.file_size === file.size),
        )
        .first();

      if (targetBook) {
        await db.books.update(targetBook.id, {
          meta: {
            ...targetBook.meta,
            source: {
              kind: source.id,
              id: entry.id,
              url: entry.formats?.[0]?.url,
            },
          },
          ...dirty(),
        });
      }

      await db.downloads.update(downloadId, {
        status: 'completed',
        progress: 1.0,
      });
    } catch (err) {
      if (abortCtrl.signal.aborted) {
        await db.downloads.update(downloadId, {
          status: 'cancelled',
          error: 'Download cancelled',
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        await db.downloads.update(downloadId, {
          status: 'failed',
          error: msg,
        });
      }
    } finally {
      this.activeControllers.delete(downloadId);
    }
  }

  async cancel(downloadId: string): Promise<void> {
    const ctrl = this.activeControllers.get(downloadId);
    if (ctrl) {
      ctrl.abort();
    }
    await db.downloads.update(downloadId, {
      status: 'cancelled',
      error: 'Download cancelled',
    });
  }

  async retry(
    downloadId: string,
    entry?: CatalogEntry,
    source?: CatalogSource,
  ): Promise<void> {
    const item = await db.downloads.get(downloadId);
    if (!item) return;

    let targetSource = source;
    if (!targetSource) {
      const { getSourceById } = await import('../../sources/registry');
      targetSource = await getSourceById(item.source);
    }
    if (!targetSource) {
      await db.downloads.update(downloadId, {
        status: 'failed',
        error: `Unknown source: ${item.source}`,
      });
      return;
    }

    const targetEntry = entry || (item.entry as unknown as CatalogEntry) || {
      id: downloadId.replace(/^dl:/, ''),
      title: item.title,
      authors: [],
      formats: [{ mime: 'application/epub+zip', url: item.url }],
      kind: item.kind,
    };

    await db.downloads.update(downloadId, {
      status: 'pending',
      error: undefined,
      progress: 0,
    });
    void this.process(downloadId, targetEntry, targetSource, 'application/epub+zip');
  }

  async remove(downloadId: string): Promise<void> {
    this.cancel(downloadId);
    await db.downloads.delete(downloadId);
  }

  async clearCompleted(): Promise<void> {
    const completed = await db.downloads
      .filter((d) => d.status === 'completed' || d.status === 'cancelled')
      .toArray();
    for (const item of completed) {
      await db.downloads.delete(item.id);
    }
  }
}

export const downloadManager = new DownloadManager();
