// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Authentication flow tests.
 * Verifies login, logout, and route protection.
 */

test.describe('Authentication', () => {
  test('redirects to /login when not authenticated', async ({ page }) => {
    const response = await page.goto('/');
    // Should redirect to login page
    expect(page.url()).toContain('/login');
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');

    // Title is visible
    await expect(page.locator('h1')).toContainText('XRS Showroom');

    // Password field exists
    const passwordInput = page.locator('#login-password');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Submit button exists
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Ingresar');
  });

  test('shows error on wrong password', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#login-password').fill('wrong-password-123');
    await page.locator('button[type="submit"]').click();

    // Wait for error message
    const errorMsg = page.locator('.login-error');
    await expect(errorMsg).toBeVisible({ timeout: 10_000 });
    await expect(errorMsg).toContainText('Contraseña incorrecta');
  });

  test('login with correct password redirects to home', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#login-password').fill(process.env.ADMIN_PASSWORD || 'novaworks2026');
    await page.locator('button[type="submit"]').click();

    // Should redirect away from login
    await page.waitForURL('/', { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('authenticated user can access home page', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.locator('#login-password').fill(process.env.ADMIN_PASSWORD || 'novaworks2026');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('/', { timeout: 15_000 });

    // Home page should show the title
    await expect(page.locator('h1')).toHaveText('Showroom');
  });

  test('/scenes/* routes are protected', async ({ page }) => {
    // Try to access scenes without auth
    await page.goto('/scenes/some-id');
    expect(page.url()).toContain('/login');
  });

  test('/view/* routes are public', async ({ page }) => {
    const response = await page.goto('/view/test-id');
    // Should NOT redirect to login (view is public)
    expect(page.url()).not.toContain('/login');
    expect(page.url()).toContain('/view/');
  });
});
