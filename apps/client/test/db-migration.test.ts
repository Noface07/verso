import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';

describe('Phase 13: Dexie Database Schema Upgrades & Hot Query Indexes', () => {
  it('migrates from schema v1 through v5 without data loss and enables compound indexes', async () => {
    const testDbName = `folio_migration_test_${Date.now()}`;

    // Step 1: Open DB at version 1 and populate fixture data
    const dbV1 = new Dexie(testDbName);
    dbV1.version(1).stores({
      books: 'id, title, author, added_at, last_opened_at, _dirty',
      progress: 'id, _dirty',
      annotations: 'id, book_id, type, _dirty',
      collections: 'id, _dirty',
      collection_books: 'id, collection_id, book_id, _dirty',
      reading_sessions: 'id, book_id, started_at, _dirty',
      settings: 'id, _dirty',
      files: 'hash',
      covers: 'id',
      kv: 'key',
    });
    await dbV1.open();

    await dbV1.table('books').add({
      id: 'book-mig-1',
      title: 'Moby Dick',
      author: 'Herman Melville',
      added_at: 1000,
      last_opened_at: 1050,
      _dirty: 0,
    });

    await dbV1.table('annotations').bulkAdd([
      {
        id: 'ann-1',
        book_id: 'book-mig-1',
        type: 'highlight',
        text: 'Call me Ishmael',
        created_at: 1010,
        _dirty: 0,
      },
      {
        id: 'ann-2',
        book_id: 'book-mig-1',
        type: 'bookmark',
        text: 'Chapter 1',
        created_at: 1020,
        _dirty: 0,
      },
      {
        id: 'ann-3',
        book_id: 'other-book',
        type: 'bookmark',
        text: 'Other',
        created_at: 1030,
        _dirty: 0,
      },
    ]);

    await dbV1.table('reading_sessions').bulkAdd([
      {
        id: 'sess-1',
        book_id: 'book-mig-1',
        started_at: 1000,
        ended_at: 1100,
        duration_sec: 100,
        _dirty: 0,
      },
      {
        id: 'sess-2',
        book_id: 'book-mig-1',
        started_at: 2000,
        ended_at: 2150,
        duration_sec: 150,
        _dirty: 0,
      },
    ]);

    dbV1.close();

    // Step 2: Open DB with the full multi-version schema up to version 5
    const dbFull = new Dexie(testDbName);
    dbFull.version(1).stores({
      books: 'id, title, author, added_at, last_opened_at, _dirty',
      progress: 'id, _dirty',
      annotations: 'id, book_id, type, _dirty',
      collections: 'id, _dirty',
      collection_books: 'id, collection_id, book_id, _dirty',
      reading_sessions: 'id, book_id, started_at, _dirty',
      settings: 'id, _dirty',
      files: 'hash',
      covers: 'id',
      kv: 'key',
    });
    dbFull.version(2).stores({
      books: 'id, title, author, added_at, last_opened_at, _dirty',
      progress: 'id, _dirty',
      annotations: 'id, book_id, type, _dirty',
      collections: 'id, _dirty',
      collection_books: 'id, collection_id, book_id, _dirty',
      reading_sessions: 'id, book_id, started_at, _dirty',
      settings: 'id, _dirty',
      series: 'id, source, title, last_read_at, _dirty',
      chapter_progress: 'id, series_id, source, _dirty',
      sources: 'id, kind, _dirty',
      devices: 'id, _dirty',
      files: 'hash',
      covers: 'id',
      kv: 'key',
    });
    dbFull.version(3).stores({
      downloads: 'id, source, status, created_at',
      catalog_cache: 'key, expires_at',
      source_credentials: 'id',
    });
    dbFull.version(4).stores({
      manga_pages: 'id, series_id, chapter_id, [series_id+chapter_id]',
    });
    dbFull.version(5).stores({
      annotations: 'id, book_id, type, created_at, [book_id+type], _dirty',
      reading_sessions: 'id, book_id, started_at, [book_id+started_at], _dirty',
      chapter_progress: 'id, series_id, source, [series_id+read], [series_id+chapter_number], _dirty',
    });

    await dbFull.open();
    expect(dbFull.verno).toBe(5);

    // Verify all existing records remain intact
    const book = await dbFull.table('books').get('book-mig-1');
    expect(book).toBeDefined();
    expect(book.title).toBe('Moby Dick');

    const totalAnnotations = await dbFull.table('annotations').count();
    expect(totalAnnotations).toBe(3);

    // Verify hot query compound index: [book_id+type]
    const bookBookmarks = await dbFull
      .table('annotations')
      .where('[book_id+type]')
      .equals(['book-mig-1', 'bookmark'])
      .toArray();
    expect(bookBookmarks).toHaveLength(1);
    expect(bookBookmarks[0].id).toBe('ann-2');

    // Verify hot query compound index: [book_id+started_at]
    const bookSessions = await dbFull
      .table('reading_sessions')
      .where('[book_id+started_at]')
      .between(['book-mig-1', 500], ['book-mig-1', 1500])
      .toArray();
    expect(bookSessions).toHaveLength(1);
    expect(bookSessions[0].id).toBe('sess-1');

    // Verify v2/v5 table chapter_progress with compound index
    await dbFull.table('chapter_progress').bulkAdd([
      { id: 'cp-1', series_id: 'ser-1', source: 'mangadex', chapter_id: 'ch-1', read: 1, _dirty: 0 },
      { id: 'cp-2', series_id: 'ser-1', source: 'mangadex', chapter_id: 'ch-2', read: 0, _dirty: 0 },
    ]);

    const unread = await dbFull
      .table('chapter_progress')
      .where('[series_id+read]')
      .equals(['ser-1', 0])
      .toArray();
    expect(unread).toHaveLength(1);
    expect(unread[0].chapter_id).toBe('ch-2');

    dbFull.close();
    await Dexie.delete(testDbName);
  });
});
