// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Side panel & unit drawer tests.
 * Verifies the left sidebar tab navigation and right-side unit detail drawer.
 */

const TEST_SCENE_ID = '-OpndSMhuRHI-q2icUEl';

test.describe('Side Panel & Unit Drawer (/view)', () => {
  // Scene loading can be slow in CI
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(`/view/${TEST_SCENE_ID}`);
    // Wait for loading screen to dismiss
    const loader = page.locator('.loading-split');
    await expect(loader).toBeHidden({ timeout: 80_000 });
  });

  test('left panel is visible on desktop', async ({ page }) => {
    const panel = page.locator('.left-panel-stack');
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar header with logo or project name is visible', async ({ page }) => {
    const header = page.locator('.sidebar-header');
    await expect(header).toBeVisible({ timeout: 5_000 });
  });

  test('tab bar is visible with Unidades and Amenities tabs', async ({ page }) => {
    const tabs = page.locator('.sidebar-tabs .sidebar-tab');
    await expect(tabs).toHaveCount(2, { timeout: 5_000 });

    await expect(tabs.nth(0)).toContainText('Unidades');
    await expect(tabs.nth(1)).toContainText('Amenities');
  });

  test('Unidades tab is active by default', async ({ page }) => {
    const firstTab = page.locator('.sidebar-tab').first();
    await expect(firstTab).toHaveClass(/active/, { timeout: 5_000 });
  });

  test('switching to Amenities tab works', async ({ page }) => {
    const amenitiesTab = page.locator('.sidebar-tab', { hasText: 'Amenities' });
    await amenitiesTab.click();
    await expect(amenitiesTab).toHaveClass(/active/);

    // Unidades tab should no longer be active
    const unidadesTab = page.locator('.sidebar-tab', { hasText: 'Unidades' });
    await expect(unidadesTab).not.toHaveClass(/active/);
  });

  test('clicking a unit opens the right-side drawer', async ({ page }) => {
    // Wait for unit cards to load
    const unitCard = page.locator('.unidad-card').first();
    await expect(unitCard).toBeVisible({ timeout: 10_000 });

    // Click a unit
    await unitCard.click();

    // Drawer should appear
    const drawer = page.locator('.unit-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should show the unit title
    const title = page.locator('.unit-drawer-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Unidad');
  });

  test('clicking outside the drawer closes it', async ({ page }) => {
    // Open the drawer
    const unitCard = page.locator('.unidad-card').first();
    await expect(unitCard).toBeVisible({ timeout: 10_000 });
    await unitCard.click();

    const drawer = page.locator('.unit-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Click on the canvas area (outside the drawer)
    await page.locator('.viewer-canvas-container').click({ position: { x: 100, y: 100 }, force: true });

    // Drawer should close
    await expect(drawer).toBeHidden({ timeout: 3_000 });
  });

  test.skip('clicking the same unit again closes the drawer', async ({ page }) => {
    const unitCard = page.locator('.unidad-card').first();
    await expect(unitCard).toBeVisible({ timeout: 10_000 });

    // Open
    await unitCard.click();
    const drawer = page.locator('.unit-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Close by clicking again
    await unitCard.click();
    await expect(drawer).toBeHidden({ timeout: 3_000 });
  });

  test('drawer shows floor plan and info sections', async ({ page }) => {
    const unitCard = page.locator('.unidad-card').first();
    await expect(unitCard).toBeVisible({ timeout: 10_000 });
    await unitCard.click();

    const drawer = page.locator('.unit-drawer');
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should have floor plan section
    const plan = page.locator('.unit-drawer-plan');
    await expect(plan).toBeVisible();

    // Should have info section with rows
    const info = page.locator('.unit-drawer-info');
    await expect(info).toBeVisible();

    // Should have action buttons
    const actions = page.locator('.unit-drawer-actions');
    await expect(actions).toBeVisible();
  });

  test('3D canvas is offset by panel width on desktop', async ({ page }) => {
    const canvas = page.locator('.viewer-canvas-container');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Canvas should have left offset of 340px on desktop
    const left = await canvas.evaluate((el) => getComputedStyle(el).left);
    expect(left).toBe('340px');
  });
});
