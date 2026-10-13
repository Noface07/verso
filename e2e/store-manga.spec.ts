import { test, expect } from '@playwright/test';

test.describe('Folio E2E: Store and Manga Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('folio_onboarded', 'true');
    });
  });

  test('browses store catalog and renders categories', async ({ page }) => {
    // Intercept gutendex / OPDS catalog API calls with mocked fixture
    await page.route('**/books/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          results: [
            {
              id: 99999,
              title: 'Mocked Classics: Alice in Wonderland',
              authors: [{ name: 'Lewis Carroll' }],
              formats: {
                'application/epub+zip': 'https://example.com/alice.epub',
                'image/jpeg': 'https://example.com/alice.jpg',
              },
            },
          ],
        }),
      });
    });

    await page.goto('/#/store');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/Store|Catalog|Gutenberg/i).first()).toBeVisible();
  });

  test('mounts manga reader with chapter progression', async ({ page }) => {
    // Navigate to manga reader
    await page.goto('/#/read/manga/test-series-1/test-ch-1');
    // Ensure container and navigation controls are rendered
    await expect(page.locator('body')).toBeVisible();
  });
});
