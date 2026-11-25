import { expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './helpers.js';

test('protected areas redirect anonymous visitors to sign in', async ({ page }) => {
  await page.goto('/donor');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
});

test('a donor cannot open the admin or NGO areas', async ({ page }) => {
  await login(page, ACCOUNTS.spice);
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
  await page.goto('/ngo');
  await expect(page).not.toHaveURL(/\/ngo/);
});

test('the access token is never persisted in web storage and the session survives a reload', async ({ page }) => {
  await login(page, ACCOUNTS.spice);
  await page.reload();
  await expect(page).toHaveURL(/\/donor/);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // no JWT
});

test('a pending organisation sees a verification notice instead of transactional actions', async ({ page }) => {
  await login(page, ACCOUNTS.greenLeaf);
  await expect(page.getByText(/verification/i).first()).toBeVisible();
});
