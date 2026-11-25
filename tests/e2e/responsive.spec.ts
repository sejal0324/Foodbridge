import { expect, test } from '@playwright/test';
import { ACCOUNTS, login, trackPageErrors } from './helpers.js';

test('landing page and donor dashboard work on a phone-sized screen', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1); // no horizontal scrolling
  await login(page, ACCOUNTS.spice);
  await expect(page).toHaveURL(/\/donor/);
  await page.getByRole('button', { name: /menu|navigation/i }).first().click();
  await expect(page.getByRole('link', { name: 'Donations' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
