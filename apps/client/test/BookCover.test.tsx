import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BookCover } from '../src/components/BookCover';
import type { Book } from '../src/db';

describe('BookCover component', () => {
  it('renders fallback with title and author when cover_hash is null', () => {
    const book: Book = {
      id: 'a1b2c3d4-1111-2222-3333-444455556666',
      title: 'The Great Gatsby',
      author: 'F. Scott Fitzgerald',
      format: 'epub',
      file_hash: 'hash123',
      file_size: 1024,
      cover_hash: null,
      meta: { file_name: 'gatsby.epub', mime: 'application/epub+zip' },
      added_at: Date.now(),
      last_opened_at: null,
      updated_at: Date.now(),
      deleted_at: null,
      _dirty: 0,
    };

    render(<BookCover book={book} />);

    expect(screen.getByText('The Great Gatsby')).toBeInTheDocument();
    expect(screen.getByText('F. Scott Fitzgerald')).toBeInTheDocument();
  });
});
