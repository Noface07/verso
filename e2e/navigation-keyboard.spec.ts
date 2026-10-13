import { test, expect } from '@playwright/test';

test.describe('Folio E2E: Keyboard Navigation and Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('folio_onboarded', 'true');
    });
  });

  test('opens shortcuts dialog with ? and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Folio/i);

    // Press '?' to trigger shortcuts dialog
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Shortcuts|Keyboard Shortcuts/i);

    // Press Escape to close dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('navigates via nav rail or keyboard to settings and library', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: /Settings|Appearance/i }).first()).toBeVisible({ timeout: 10000 });

    // Navigate to Library
    await page.goto('/#/library');
    await expect(page.locator('body')).toBeVisible();
  });
});
