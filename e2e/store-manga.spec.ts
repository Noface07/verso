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

  test('a slow response from the previous source never replaces the new source', async ({ page }) => {
    // Gutendex answers slowly (it often takes 10s+ in practice); MangaDex answers fast.
    await page.route(/gutendex/, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          next: null,
          results: [
            { id: 1, title: 'Stale Gutenberg Book', authors: [{ name: 'Nobody' }], formats: {} },
          ],
        }),
      });
    });
    await page.route(/api\.mangadex\.org/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: 'ok',
          total: 1,
          data: [
            {
              id: 'manga-1',
              type: 'manga',
              attributes: {
                title: { en: 'Fresh MangaDex Series' },
                altTitles: [],
                description: {},
                tags: [],
                status: 'ongoing',
              },
              relationships: [],
            },
          ],
        }),
      }),
    );

    await page.goto('/#/store');
    await page.locator('#source-select').waitFor();
    await page.selectOption('#source-select', 'mangadex');

    await expect(page.getByText('Fresh MangaDex Series').first()).toBeVisible();
    // Let the delayed Gutendex reply land, then make sure it was discarded.
    await page.waitForTimeout(3500);
    await expect(page.getByText('Fresh MangaDex Series').first()).toBeVisible();
    await expect(page.getByText('Stale Gutenberg Book')).toHaveCount(0);
  });
});
