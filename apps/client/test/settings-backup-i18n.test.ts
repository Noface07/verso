import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db';
import { exportBackup, importBackup } from '../src/lib/backup';
import { t, isRtlLanguage, updateDocumentDirection, setAppLanguage } from '../src/lib/i18n';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingModal } from '../src/components/OnboardingModal';

describe('Phase 12: Settings, Backup, Onboarding, Accessibility, and i18n', () => {
  beforeEach(async () => {
    await db.books.clear();
    await db.annotations.clear();
    await db.progress.clear();
    await db.settings.clear();
  });

  afterEach(async () => {
    await db.books.clear();
    await db.annotations.clear();
    await db.progress.clear();
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  describe('P12.1: Internationalization (i18n) & RTL Layout', () => {
    it('translates common keys with t()', () => {
      expect(t('common.appName')).toBe('Verso');
      expect(t('common.save')).toBe('Save');
      expect(t('common.cancel')).toBe('Cancel');
      expect(t('settings.title')).toBe('Settings');
    });

    it('identifies RTL languages correctly', () => {
      expect(isRtlLanguage('ar')).toBe(true);
      expect(isRtlLanguage('ar-SA')).toBe(true);
      expect(isRtlLanguage('he')).toBe(true);
      expect(isRtlLanguage('fa')).toBe(true);
      expect(isRtlLanguage('ur')).toBe(true);
      expect(isRtlLanguage('en')).toBe(false);
      expect(isRtlLanguage('fr')).toBe(false);
      expect(isRtlLanguage('ja')).toBe(false);
    });

    it('updates document direction and language attribute', async () => {
      updateDocumentDirection('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');

      updateDocumentDirection('en');
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe('en');

      await setAppLanguage('en');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });

  describe('P12.2: Backup & Restore Engine (.foliobackup) with LWW', () => {
    it('exports and restores database rows with Last-Write-Wins merge', async () => {
      const now = Date.now();
      await db.books.put({
        id: 'book-1',
        title: 'Original Title',
        author: 'Author A',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1024,
        cover_hash: null,
        meta: { file_name: 'b1.epub', mime: 'application/epub+zip' },
        added_at: now - 5000,
        last_opened_at: null,
        updated_at: now - 2000,
        deleted_at: null,
        _dirty: 0,
      });

      await db.annotations.put({
        id: 'ann-1',
        book_id: 'book-1',
        type: 'highlight',
        cfi: '/4/2',
        text: 'Initial highlight',
        color: 'yellow',
        style: 'highlight',
        note: '',
        updated_at: now - 2000,
        deleted_at: null,
        _dirty: 0,
      });

      // 1. Export backup
      const backupBlob = await exportBackup({ excludeFiles: true });
      expect(backupBlob).toBeDefined();
      expect(backupBlob.size).toBeGreaterThan(0);

      // 2. Modify local record with newer timestamp
      await db.books.put({
        id: 'book-1',
        title: 'Newer Local Title',
        author: 'Author A',
        format: 'EPUB',
        file_hash: 'hash-1',
        file_size: 1024,
        cover_hash: null,
        meta: { file_name: 'b1.epub', mime: 'application/epub+zip' },
        added_at: now - 5000,
        last_opened_at: null,
        updated_at: now, // newer than backup
        deleted_at: null,
        _dirty: 0,
      });

      // 3. Add a new book in backup scenario by clearing and putting an older one
      const result = await importBackup(backupBlob);
      expect(result.totalRows).toBeGreaterThan(0);

      // Verify that newer local title was preserved (LWW: local updated_at > backup updated_at)
      const currentBook = await db.books.get('book-1');
      expect(currentBook?.title).toBe('Newer Local Title');

      // Verify annotation was preserved
      const currentAnn = await db.annotations.get('ann-1');
      expect(currentAnn?.text).toBe('Initial highlight');
    });
  });

  describe('P12.4: First-Launch Onboarding Wizard', () => {
    it('navigates through steps 1, 2, and 3 and triggers completion', async () => {
      const onCompleteSpy = vi.fn();
      const { ThemeProvider } = await import('../src/design/theme');
      render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(OnboardingModal, {
            open: true,
            onComplete: onCompleteSpy,
          }),
        ),
      );

      // Step 1: Welcome & Theme
      expect(screen.getByText(/Welcome to Verso/i)).toBeInTheDocument();
      const continueBtn1 = screen.getByRole('button', { name: /continue/i });
      fireEvent.click(continueBtn1);

      // Step 2: Add Books
      expect(screen.getByText(/Add your library/i)).toBeInTheDocument();
      const continueBtn2 = screen.getByRole('button', { name: /continue/i });
      fireEvent.click(continueBtn2);

      // Step 3: Sync & Start Reading
      expect(screen.getByText(/Sync Everywhere/i)).toBeInTheDocument();
      const finishBtn = screen.getByRole('button', { name: /start reading/i });
      fireEvent.click(finishBtn);

      expect(onCompleteSpy).toHaveBeenCalledTimes(1);
    });
  });
});
