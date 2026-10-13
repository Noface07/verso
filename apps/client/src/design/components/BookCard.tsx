import type { FC } from 'react';
import { twMerge } from 'tailwind-merge';
import { BookCover, type BookCoverProps } from './BookCover';

export interface BookCardProps extends BookCoverProps {
  showMetadata?: boolean;
}

export const BookCard: FC<BookCardProps> = ({
  title,
  author,
  showMetadata = true,
  className,
  ...coverProps
}) => {
  return (
    <div className={twMerge('flex flex-col group select-none', className)}>
      <BookCover title={title} author={author} {...coverProps} />
      {showMetadata && (
        <div className="mt-2.5 px-0.5">
          <h4 className="text-xs font-medium text-[var(--text-1)] line-clamp-2 leading-snug group-hover:text-[var(--accent)] transition-colors">
            {title}
          </h4>
          <p className="text-[11px] text-[var(--text-3)] line-clamp-1 mt-0.5">
            {author}
          </p>
        </div>
      )}
    </div>
  );
};
