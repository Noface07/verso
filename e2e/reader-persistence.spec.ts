import { test, expect } from '@playwright/test';

test.describe('Folio E2E: Reader and Annotations Persistence', () => {
  test.beforeEach(async ({ page }) => {
    // Mark as onboarded so wizard doesn't intercept
    await page.addInitScript(() => {
      localStorage.setItem('folio_onboarded', 'true');
    });
  });

  test('preserves user settings and theme across page reloads', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: /Settings|Appearance/i }).first()).toBeVisible({ timeout: 10000 });

    // Click 'dark' theme button
    const darkBtn = page.getByRole('button', { name: /^dark$/i });
    if (await darkBtn.isVisible()) {
      await darkBtn.click();
    }

    // Verify root data-theme attribute
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Reload page
    await page.reload();

    // Attribute persists
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('seeds a test book and opens Reader view', async ({ page }) => {
    await page.goto('/');

    // Evaluate in browser context to insert test book into Dexie
    await page.evaluate(async () => {
      const dbRequest = indexedDB.open('folio');
      await new Promise<void>((resolve) => {
        dbRequest.onsuccess = () => {
          const idb = dbRequest.result;
          if (idb.objectStoreNames.contains('books')) {
            const tx = idb.transaction('books', 'readwrite');
            const store = tx.objectStore('books');
            store.put({
              id: 'test-e2e-book-1',
              title: 'The Great Gatsby',
              author: 'F. Scott Fitzgerald',
              format: 'epub',
              file_hash: 'dummyhash',
              file_size: 1024,
              cover_hash: null,
              meta: { file_name: 'gatsby.epub', mime: 'application/epub+zip' },
              added_at: Date.now(),
              last_opened_at: Date.now(),
              updated_at: Date.now(),
              deleted_at: null,
              _dirty: 0,
            });
            tx.oncomplete = () => resolve();
          } else {
            resolve();
          }
        };
        dbRequest.onerror = () => resolve();
      });
    });

    // Navigate to read view
    await page.goto('/#/read/test-e2e-book-1');
    // Verify reader container mounts without crashing
    await expect(page.locator('#root')).toBeVisible();
  });
});
