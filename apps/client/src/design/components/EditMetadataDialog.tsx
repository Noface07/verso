import React, { useState, useEffect, useRef } from 'react';
import { Star, Upload, Link as LinkIcon, X, Plus, Loader2 } from 'lucide-react';
import { db, dirty, type Book } from '../../db';
import { sha256 } from '../../lib/hash';
import { extractCoverColor, useTheme } from '../theme';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { BookCover } from './BookCover';

export interface EditMetadataDialogProps {
  open: boolean;
  book: Book | null;
  onClose: () => void;
  onSaved?: (updatedBook: Book) => void;
}

async function resizeCoverBlob(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / bmp.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.85),
    );
  } catch {
    return blob;
  }
}

export const EditMetadataDialog: React.FC<EditMetadataDialogProps> = ({
  open,
  book,
  onClose,
  onSaved,
}) => {
  const { resolvedTheme } = useTheme();

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [series, setSeries] = useState('');
  const [seriesNumber, setSeriesNumber] = useState<string>('');
  const [language, setLanguage] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [rating, setRating] = useState<number>(0);

  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverUrlInput, setCoverUrlInput] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author);
      setSeries(book.meta.series ?? '');
      setSeriesNumber(
        book.meta.series_number !== undefined ? String(book.meta.series_number) : '',
      );
      setLanguage(book.meta.language ?? '');
      setDescription(book.meta.description ?? '');
      setTags(book.meta.tags ? [...book.meta.tags] : []);
      setRating(book.meta.rating ?? 0);
      setCoverBlob(null);
      setCoverPreviewUrl(null);
      setCoverUrlInput('');
      setTagInput('');
    }
  }, [book, open]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
    };
  }, [coverPreviewUrl]);

  if (!book) return null;

  const handleAddTag = () => {
    const trimmed = tagInput.trim().replace(/^#/, '');
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeCoverBlob(file);
      setCoverBlob(resized);
      const url = URL.createObjectURL(resized);
      setCoverPreviewUrl(url);
    } catch {
      // Ignore invalid image
    }
  };

  const handleFetchCoverUrl = async () => {
    const url = coverUrlInput.trim();
    if (!url) return;
    setFetchingUrl(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load image');
      const blob = await res.blob();
      const resized = await resizeCoverBlob(blob);
      setCoverBlob(resized);
      const objUrl = URL.createObjectURL(resized);
      setCoverPreviewUrl(objUrl);
      setCoverUrlInput('');
    } catch {
      alert('Could not fetch image from this URL.');
    } finally {
      setFetchingUrl(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      let coverHash = book.cover_hash;
      let accent = book.meta.accent;

      if (coverBlob) {
        const buffer = await coverBlob.arrayBuffer();
        coverHash = await sha256(buffer);
        await db.covers.put({ id: book.id, blob: coverBlob });
        accent = await extractCoverColor(coverBlob, resolvedTheme === 'dark');
      }

      const parsedSeriesNum = seriesNumber.trim() ? parseFloat(seriesNumber) : undefined;

      const updatedMeta = {
        ...book.meta,
        series: series.trim() || undefined,
        series_number: !isNaN(parsedSeriesNum as number) ? parsedSeriesNum : undefined,
        language: language.trim() || undefined,
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        rating: rating > 0 ? rating : undefined,
        accent,
      };

      const updates: Partial<Book> = {
        title: title.trim(),
        author: author.trim() || 'Unknown author',
        cover_hash: coverHash,
        meta: updatedMeta,
        ...dirty(),
      };

      await db.books.update(book.id, updates);

      const updatedBook: Book = {
        ...book,
        ...updates,
      };

      onSaved?.(updatedBook);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Edit metadata" className="max-w-xl">
      <form onSubmit={handleSave} className="space-y-4">
        {/* Top: Cover preview & Cover Replacement Controls */}
        <div className="flex gap-4 p-3 rounded-lg bg-[var(--layer-2)] border border-[var(--stroke)] items-center">
          <div className="w-20 shrink-0">
            {coverPreviewUrl ? (
              <div className="aspect-[2/3] w-full rounded-[var(--r-cover)] overflow-hidden shadow-xs border border-[var(--stroke)]">
                <img
                  src={coverPreviewUrl}
                  alt="New cover preview"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <BookCover
                id={book.id}
                title={title || book.title}
                author={author || book.author}
                coverHash={book.cover_hash}
                className="w-20 pointer-events-none"
              />
            )}
          </div>

          <div className="flex-1 space-y-2">
            <span className="text-xs font-semibold text-[var(--text-1)] block">
              Book Cover
            </span>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="standard"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 text-xs"
              >
                <Upload className="w-3.5 h-3.5 text-[var(--text-2)]" />
                Upload image
              </Button>
            </div>

            <div className="flex items-center gap-1.5 mt-1">
              <input
                type="url"
                placeholder="Or paste image URL"
                value={coverUrlInput}
                onChange={(e) => setCoverUrlInput(e.target.value)}
                className="flex-1 text-xs px-2.5 py-1.5 rounded-md bg-[var(--layer-3)] border border-[var(--stroke)] text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)]"
              />
              <Button
                type="button"
                variant="standard"
                size="sm"
                onClick={handleFetchCoverUrl}
                disabled={!coverUrlInput.trim() || fetchingUrl}
                className="gap-1 text-xs shrink-0"
              >
                {fetchingUrl ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LinkIcon className="w-3.5 h-3.5 text-[var(--text-2)]" />
                )}
                Fetch
              </Button>
            </div>
          </div>
        </div>

        {/* Title & Author */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="meta-title"
              className="block text-xs font-medium text-[var(--text-2)] mb-1"
            >
              Title <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              id="meta-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label
              htmlFor="meta-author"
              className="block text-xs font-medium text-[var(--text-2)] mb-1"
            >
              Author
            </label>
            <input
              id="meta-author"
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Series & Volume Number */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label
              htmlFor="meta-series"
              className="block text-xs font-medium text-[var(--text-2)] mb-1"
            >
              Series name
            </label>
            <input
              id="meta-series"
              type="text"
              placeholder="e.g. The Lord of the Rings"
              value={series}
              onChange={(e) => setSeries(e.target.value)}
              className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label
              htmlFor="meta-volume"
              className="block text-xs font-medium text-[var(--text-2)] mb-1"
            >
              Volume #
            </label>
            <input
              id="meta-volume"
              type="number"
              step="any"
              placeholder="e.g. 1"
              value={seriesNumber}
              onChange={(e) => setSeriesNumber(e.target.value)}
              className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Rating & Language */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <div>
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">
              Rating (0–5 stars)
            </span>
            <div className="flex items-center gap-1 py-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(rating === star ? 0 : star)}
                  className="p-1 rounded hover:bg-[var(--layer-3)] transition-colors cursor-pointer text-[var(--text-3)] hover:text-amber-400"
                  aria-label={`Rate ${star} star`}
                >
                  <Star
                    className={`w-4 h-4 ${
                      star <= rating ? 'fill-amber-400 text-amber-400' : ''
                    }`}
                  />
                </button>
              ))}
              {rating > 0 && (
                <button
                  type="button"
                  onClick={() => setRating(0)}
                  className="text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] ml-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div>
            <label
              htmlFor="meta-lang"
              className="block text-xs font-medium text-[var(--text-2)] mb-1"
            >
              Language
            </label>
            <input
              id="meta-lang"
              type="text"
              placeholder="e.g. en, ja, fr"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Tags */}
        <div>
          <span className="block text-xs font-medium text-[var(--text-2)] mb-1">
            Tags
          </span>
          <div className="flex flex-wrap gap-1.5 p-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] min-h-[38px] items-center">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:text-[var(--danger)] cursor-pointer"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <div className="inline-flex items-center gap-1 flex-1 min-w-[120px]">
              <input
                id="meta-tag-input"
                type="text"
                placeholder={tags.length === 0 ? 'Type tag and press Enter...' : 'Add tag...'}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className="w-full text-xs bg-transparent border-none outline-none text-[var(--text-1)] placeholder-[var(--text-3)] px-1"
              />
              {tagInput.trim() && (
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="p-1 text-[var(--accent)] hover:bg-[var(--layer-3)] rounded cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="meta-description"
            className="block text-xs font-medium text-[var(--text-2)] mb-1"
          >
            Description
          </label>
          <textarea
            id="meta-description"
            rows={3}
            placeholder="Book summary or synopsis..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-xs px-2.5 py-2 rounded-md bg-[var(--layer-2)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)] resize-y"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--stroke)]">
          <Button type="button" variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="accent" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
