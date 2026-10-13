import { test, expect } from '@playwright/test';

test.describe('Folio basic smoke test', () => {
  test('loads home page and has title or main shell', async ({ page }) => {
    await page.goto('/');
    // Check that title or root element renders
    await expect(page).toHaveTitle(/Folio/i);
  });
});
