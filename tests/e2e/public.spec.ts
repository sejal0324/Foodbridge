import { expect, test } from '@playwright/test';
import { API, trackPageErrors } from './helpers.js';

test('landing page shows the product and live impact numbers from the API', async ({ page }) => {
  const errors = trackPageErrors(page);
  const impact = (await (await fetch(`${API}/public/impact`)).json()).data as { mealsRedistributed: number; verifiedNgos: number };
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Turn Surplus Food Into Someone's Next Meal.");
  await expect(page.getByText(/across India/i).first()).toBeVisible();
  // Real figures, not hardcoded: the seeded completed collection redistributed 60 meals.
  expect(impact.mealsRedistributed).toBeGreaterThan(0);
  await expect(page.getByText(String(impact.mealsRedistributed), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/demo data/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('registration offers India-wide location search and the Indian states list', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('heading').first()).toBeVisible();
  const state = page.getByLabel(/^State/).first();
  await expect(state).toBeVisible();
  await expect(state.locator('option', { hasText: 'Tamil Nadu' })).toHaveCount(1);
  await expect(state.locator('option', { hasText: 'Ladakh' })).toHaveCount(1);
});
