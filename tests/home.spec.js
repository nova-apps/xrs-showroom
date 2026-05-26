// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Home page tests.
 * Verifies the scene library page renders correctly after authentication.
 */

// Helper: login before each test
async function login(page) {
  await page.goto('/login');
  await page.locator('#login-password').fill(process.env.ADMIN_PASSWORD || 'novaworks2026');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('/', { timeout: 15_000 });
}

test.describe('Home Page (Scene List)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('displays the app title', async ({ page }) => {
    await expect(page.locator('.library-brand-logo')).toHaveText('XRS');
    await expect(page.locator('h1')).toHaveText('Showroom');
  });

  test('shows the scene count', async ({ page }) => {
    await expect(page.locator('.library-brand p')).toContainText('escena');
  });

  test('create modal has a name input', async ({ page }) => {
    await page.locator('.library-create-btn').click();
    const input = page.locator('.library-create-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', 'Nombre de la escena…');
  });

  test('create button is disabled when name is empty', async ({ page }) => {
    await page.locator('.library-create-btn').click();
    const btn = page.locator('.library-create-actions .btn-primary');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('create button enables when name is typed', async ({ page }) => {
    await page.locator('.library-create-btn').click();
    const input = page.locator('.library-create-input');
    const btn = page.locator('.library-create-actions .btn-primary');

    await input.fill('Test Scene');
    await expect(btn).toBeEnabled();
  });

  test('renders scene list or empty state', async ({ page }) => {
    // Wait for loading to finish
    await page.waitForTimeout(2000);

    const cards = page.locator('.library-card');
    const emptyState = page.locator('.library-empty');

    // Either scenes are shown or the empty state is displayed
    const hasScenes = await cards.count() > 0;
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(hasScenes || hasEmptyState).toBe(true);
  });

  test('scene cards open the detail panel on click', async ({ page }) => {
    // Wait for scenes to load
    await page.waitForTimeout(2000);

    const cards = page.locator('.library-card');
    const count = await cards.count();

    if (count > 0) {
      const firstCard = cards.first();
      await expect(firstCard.locator('.library-card-name')).toBeVisible();

      // Clicking a card opens the side detail panel with its actions.
      await firstCard.click();
      await expect(page.locator('.library-panel')).toBeVisible();
      await expect(page.locator('.library-panel-title')).toBeVisible();
      await expect(page.locator('.library-panel-link-btn-danger')).toBeVisible();
    }
  });
});
