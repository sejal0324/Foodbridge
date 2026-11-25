import { expect, test } from '@playwright/test';
import { ACCOUNTS, apiAs, login, trackPageErrors } from './helpers.js';

/**
 * Scenario A in the browser (donor side through the real UI; the NGO's steps
 * are arranged through the API as the NGO user): create donation → AI-ranked
 * NGO recommendations → approve the NGO's request → verify the representative
 * (QR pass code + photo-ID check) → two-way handover → reward points.
 */
test('donor completes a donation through verified handover and earns points', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, ACCOUNTS.spice);
  await expect(page).toHaveURL(/\/donor/);

  // 1. Create a donation through the form.
  await page.goto('/donor/donations/new');
  await page.getByLabel('Food name').fill('E2E veg thali');
  await page.getByLabel('Category').selectOption({ label: 'Cooked meals' });
  await page.getByLabel('Quantity').fill('40');
  await page.getByLabel('I confirm this food is safe and fit for people to eat').check();
  await page.getByRole('button', { name: 'Publish donation' }).click();
  await expect(page).toHaveURL(/\/donor\/donations\/[0-9a-f-]{36}$/);
  const donationId = page.url().split('/').pop() as string;
  await expect(page.getByText('E2E veg thali').first()).toBeVisible();

  // 2. The background worker ranks NGOs with the real AI service; explanations appear.
  await expect(page.getByText('Recommended NGOs').first()).toBeVisible();
  await expect(page.getByText(/recommended because/i).first()).toBeVisible({ timeout: 45_000 });

  // 3. The NGO requests 40 meals (arranged via the API as the NGO).
  const ngo = await apiAs(ACCOUNTS.helping);
  const req = await ngo.call('POST', `/donations/${donationId}/requests`, { quantity: 40, message: 'E2E request' });
  expect(req.status).toBe(201);
  await page.reload();
  await expect(page.getByText('Helping Hands Foundation').first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Request approved').first()).toBeVisible();
  const detail = await ngo.call('GET', `/donations/${donationId}`);
  expect(detail.body.data.reservedQuantity).toBe(40);

  // 4. The NGO assigns its representative (the owner) and generates the pickup pass.
  const allocations = await ngo.call('GET', '/allocations');
  const allocation = allocations.body.data.find((a: { donationId: string }) => a.donationId === donationId);
  const assigned = await ngo.call('POST', '/pickups/assign', { allocationId: allocation.id, representativeId: ngo.user.representative?.id });
  expect(assigned.status).toBe(201);
  const pass = await ngo.call('POST', '/pickups/generate-pass', { pickupId: assigned.body.data.id });

  // 5. Donor verifies the representative in the UI.
  await page.goto(`/donor/pickups/${assigned.body.data.id}`);
  await page.getByLabel('Pass code').fill(pass.body.data.token);
  await page.getByRole('button', { name: 'Verify code' }).click();
  // A valid pass goes straight to the photo-ID check.
  await expect(page.getByText('QR pass verified').first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'I checked the representative’s physical ID' }).check();
  await page.getByRole('button', { name: 'Confirm identity' }).click();
  await page.getByLabel(/Quantity handed over/).fill('40');
  await page.getByRole('button', { name: 'Confirm handover' }).click();
  await expect(page.getByText(/waiting/i).first()).toBeVisible();

  // 6. The NGO confirms the same quantity → CONFIRMED, 40 meals × 10 points.
  const confirm = await ngo.call('POST', '/pickups/confirm-handover', { pickupId: assigned.body.data.id, quantity: 40 });
  expect(confirm.body.data.outcome).toBe('CONFIRMED');
  await page.reload();
  await expect(page.getByText(/400/).first()).toBeVisible();
  await page.goto('/donor/rewards');
  await expect(page.getByText('400').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('donor sees an honest rejection for a forged pickup pass', async ({ page }) => {
  await login(page, ACCOUNTS.sahyadri);
  await page.goto('/donor/pickups/verify');
  await page.getByLabel('Pass code').fill('FBP1.this-is-not-a-real-pass-code');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByText(/not recognised|not a valid/i).first()).toBeVisible();
});

test('donor in another city sees that city on the map and in recommendations', async ({ page }) => {
  await login(page, ACCOUNTS.delhiDonor);
  await page.goto('/donor/donations');
  await expect(page.getByText('Chole chawal').first()).toBeVisible();
  await page.getByText('Chole chawal').first().click();
  await expect(page.getByText('Annadaan Seva Delhi').first()).toBeVisible({ timeout: 45_000 });
});
