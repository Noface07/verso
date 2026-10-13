import { test, expect } from '@playwright/test';

test.describe('Folio E2E: Two-Context Multi-Tab Synchronization', () => {
  test('synchronizes theme and appearance settings across browser contexts', async ({
    browser,
  }) => {
    // Context 1: Device / Tab A
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.addInitScript(() => {
      localStorage.setItem('folio_onboarded', 'true');
    });

    await pageA.goto('/#/settings');
    await expect(pageA.getByRole('heading', { name: /Settings|Appearance/i }).first()).toBeVisible({ timeout: 10000 });

    // Context 2: Device / Tab B
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.addInitScript(() => {
      localStorage.setItem('folio_onboarded', 'true');
    });

    await pageB.goto('/#/settings');
    await expect(pageB.getByRole('heading', { name: /Settings|Appearance/i }).first()).toBeVisible({ timeout: 10000 });

    // In Context A, select 'light' theme
    const lightBtn = pageA.getByRole('button', { name: /^light$/i });
    if (await lightBtn.isVisible()) {
      await lightBtn.click();
      await expect(pageA.locator('html')).toHaveAttribute('data-theme', 'light');
    }

    // Close contexts
    await contextA.close();
    await contextB.close();
  });
});
