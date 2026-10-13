import { describe, it, expect } from 'vitest';
import { SYNC_TABLES, validateRow } from '../src/sync-schema.js';

describe('SYNC_TABLES registry', () => {
  it('defines all required tables from Build Plan v2', () => {
    expect(SYNC_TABLES).toHaveProperty('books');
    expect(SYNC_TABLES).toHaveProperty('progress');
    expect(SYNC_TABLES).toHaveProperty('annotations');
    expect(SYNC_TABLES).toHaveProperty('collections');
    expect(SYNC_TABLES).toHaveProperty('collection_books');
    expect(SYNC_TABLES).toHaveProperty('reading_sessions');
    expect(SYNC_TABLES).toHaveProperty('settings');
    expect(SYNC_TABLES).toHaveProperty('series');
    expect(SYNC_TABLES).toHaveProperty('chapter_progress');
    expect(SYNC_TABLES).toHaveProperty('sources');
    expect(SYNC_TABLES).toHaveProperty('devices');
  });

  it('validates a valid book row', () => {
    const rawBook = {
      id: 'book-123',
      title: 'Moby Dick',
      author: 'Herman Melville',
      format: 'epub',
      file_hash: 'abc123hash',
      file_size: 102400,
      cover_hash: null,
      meta: {
        file_name: 'mobydick.epub',
        mime: 'application/epub+zip',
        word_count: 200000,
      },
      added_at: 1700000000000,
      last_opened_at: null,
      updated_at: 1700000000000,
      deleted_at: null,
      _dirty: 0,
    };

    const book = validateRow('books', rawBook);
    expect(book.id).toBe('book-123');
    expect(book.title).toBe('Moby Dick');
  });

  it('rejects invalid row data', () => {
    expect(() => validateRow('books', { id: '' })).toThrow();
  });
});
