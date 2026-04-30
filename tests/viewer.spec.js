// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Public viewer tests.
 * Verifies the /view/[id] route works without authentication.
 */

const TEST_SCENE_ID = '-OpndSMhuRHI-q2icUEl';

test.describe('Public Viewer (/view)', () => {
  test('non-existent scene shows "not found" message', async ({ page }) => {
    await page.goto('/view/nonexistent-id-12345');

    // Wait for Firebase to respond
    await page.waitForTimeout(3000);

    // Should show the error state
    const heading = page.locator('h1');
    await expect(heading).toContainText('Escena no encontrada', { timeout: 10_000 });
  });

  test('does not redirect to login (public route)', async ({ page }) => {
    await page.goto(`/view/${TEST_SCENE_ID}`);

    // URL should stay on /view, not redirect to /login
    expect(page.url()).toContain('/view/');
    expect(page.url()).not.toContain('/login');
  });

  test('canvas curtain plays opening animation on mount', async ({ page }) => {
    await page.goto(`/view/${TEST_SCENE_ID}`);

    // Canvas curtain should be present on mount
    const curtain = page.locator('.canvas-curtain');
    await expect(curtain).toBeVisible({ timeout: 10_000 });

    // Curtain halves should be present
    await expect(page.locator('.canvas-curtain-top')).toBeVisible();
    await expect(page.locator('.canvas-curtain-bottom')).toBeVisible();
  });

  test('WebGL canvas mounts', async ({ page }) => {
    await page.goto(`/view/${TEST_SCENE_ID}`);

    // Wait for the viewer to render
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test('side panel is visible immediately without waiting for assets', async ({ page }) => {
    await page.goto(`/view/${TEST_SCENE_ID}`);

    // Side panel should be visible right away (no loading screen blocking it)
    const panel = page.locator('.left-panel-stack');
    await expect(panel).toBeVisible({ timeout: 10_000 });
  });
});
