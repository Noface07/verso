import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../src/design/components/Button';
import { IconButton } from '../src/design/components/IconButton';
import { ToggleButton } from '../src/design/components/ToggleButton';
import { SegmentedControl } from '../src/design/components/SegmentedControl';
import { InfoBar } from '../src/design/components/InfoBar';
import { EmptyState } from '../src/design/components/EmptyState';
import { BookCard } from '../src/design/components/BookCard';
import { TooltipProvider } from '../src/design/components/Tooltip';
import { Bookmark, Star } from 'lucide-react';

describe('Mica Design Components', () => {
  describe('Button', () => {
    it('renders text with standard variant by default', () => {
      render(<Button>Click me</Button>);
      const btn = screen.getByRole('button', { name: 'Click me' });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    it('respects disabled state', () => {
      render(<Button disabled>Disabled button</Button>);
      const btn = screen.getByRole('button', { name: 'Disabled button' });
      expect(btn).toBeDisabled();
    });

    it('triggers onClick handler when clicked', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Action</Button>);
      fireEvent.click(screen.getByRole('button', { name: 'Action' }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('IconButton', () => {
    it('renders with accessible aria-label', () => {
      render(
        <TooltipProvider>
          <IconButton label="Save item" icon={<Bookmark data-testid="bookmark-icon" />} />
        </TooltipProvider>,
      );
      const btn = screen.getByRole('button', { name: 'Save item' });
      expect(btn).toBeInTheDocument();
      expect(screen.getByTestId('bookmark-icon')).toBeInTheDocument();
    });
  });

  describe('ToggleButton', () => {
    it('renders with pressed and active states', () => {
      const handleToggle = vi.fn();
      render(
        <TooltipProvider>
          <ToggleButton
            pressed={false}
            onPressedChange={handleToggle}
            label="Favorite"
            icon={<Star data-testid="star-icon" />}
          >
            Favorite
          </ToggleButton>
        </TooltipProvider>,
      );

      const btn = screen.getByRole('button', { name: 'Favorite' });
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(btn);
      expect(handleToggle).toHaveBeenCalledWith(true);
    });
  });

  describe('SegmentedControl', () => {
    it('renders options and responds to selection', () => {
      const handleChange = vi.fn();
      render(
        <SegmentedControl
          options={[
            { value: 'books', label: 'Books' },
            { value: 'comics', label: 'Comics' },
          ]}
          value="books"
          onChange={handleChange}
        />,
      );

      const comicsTab = screen.getByRole('tab', { name: 'Comics' });
      fireEvent.click(comicsTab);
      expect(handleChange).toHaveBeenCalledWith('comics');
    });
  });

  describe('InfoBar', () => {
    it('renders with title and message', () => {
      render(<InfoBar severity="success" title="Success Title" message="Everything is synced." />);
      expect(screen.getByText('Success Title')).toBeInTheDocument();
      expect(screen.getByText('Everything is synced.')).toBeInTheDocument();
    });
  });

  describe('EmptyState', () => {
    it('renders illustration, title, description, and action', () => {
      render(
        <EmptyState
          title="No items found"
          description="Try broadening your search terms."
          action={<Button>Clear filters</Button>}
        />,
      );
      expect(screen.getByText('No items found')).toBeInTheDocument();
      expect(screen.getByText('Try broadening your search terms.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });
  });

  describe('BookCard', () => {
    it('renders book title and author in metadata', () => {
      render(<BookCard id="book-123" title="Crime and Punishment" author="Fyodor Dostoevsky" />);
      const titleMatches = screen.getAllByText('Crime and Punishment');
      expect(titleMatches.length).toBeGreaterThanOrEqual(1);
      const authorMatches = screen.getAllByText('Fyodor Dostoevsky');
      expect(authorMatches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
