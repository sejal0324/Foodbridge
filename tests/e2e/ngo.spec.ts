import { expect, test } from '@playwright/test';
import { ACCOUNTS, apiAs, categoryId, createDonation, donorVerifiesRepresentative, inMinutes, inr, login, trackPageErrors, uniqueTag } from './helpers.js';

/**
 * NGO side through the real UI; the donor's steps are arranged through the API
 * as the donor. Roti Bank Pune with Hotel Sahyadri / Annapurna Caterers, so
 * nothing overlaps with donor.spec.ts (Spice Garden → Helping Hands).
 */

test('NGO requests a marketplace donation, collects it with a QR pass and is billed ₹5 per confirmed meal', async ({ page }) => {
  const errors = trackPageErrors(page);
  const food = `E2E dal khichdi ${uniqueTag()}`;
  const quantity = 25;
  const donor = await apiAs(ACCOUNTS.sahyadri);
  const donationId = await createDonation(donor, food, quantity);

  // 1. The NGO finds the fresh donation in the marketplace.
  await login(page, ACCOUNTS.rotibank);
  await expect(page).toHaveURL(/\/ngo/);
  await page.goto('/ngo/marketplace?sort=newest');
  await page.getByRole('link', { name: food, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/ngo/marketplace/${donationId}$`));
  await expect(page.getByRole('heading', { level: 1, name: food })).toBeVisible();

  // 2. The fee estimate (₹5 per meal) is shown before requesting; nothing is charged yet.
  await page.getByLabel('Quantity (meals)').fill(String(quantity));
  const estimate = page.getByText('Service fee estimate').locator('..');
  await expect(estimate).toContainText(`${quantity} meals × ${inr(5)}`);
  await expect(estimate).toContainText(inr(quantity * 5));
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible();
  await expect(page.getByText('Fee if this collection completes').locator('..')).toContainText(inr(quantity * 5));

  // 3. The donor approves the request (API).
  const detail = await donor.call('GET', `/donations/${donationId}`);
  const request = detail.body.data.requests.find((r: { status: string }) => r.status === 'PENDING');
  expect((await donor.call('PATCH', `/requests/${request.id}/approve`, {})).status).toBe(200);

  // 4. The NGO assigns its representative (the owner) from Collections.
  await page.goto('/ngo/collections');
  await page.getByRole('row').filter({ hasText: food }).getByRole('button', { name: 'Assign', exact: true }).click();
  const assign = page.getByRole('dialog', { name: 'Assign a representative' });
  await expect(assign).toContainText(`${quantity} meals of ${food}`);
  await assign.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Representative assigned').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Assigned' }).click();
  await page.getByRole('row').filter({ hasText: food }).getByRole('link', { name: /^Open/ }).click();
  await expect(page).toHaveURL(/\/ngo\/pickups\/[0-9a-f-]{36}$/);
  const pickupId = page.url().split('/').pop() as string;

  // 5. The representative generates the QR pickup pass; the code for manual entry is visible.
  await page.getByRole('button', { name: 'Generate pass' }).click();
  await expect(page.getByRole('img', { name: `Pickup pass for ${food}` })).toBeVisible();
  const code = page.getByText(/^FBP1\.\S+$/);
  await expect(code).toBeVisible();
  const passToken = (await code.textContent())?.trim() as string;

  // 6. The donor checks the pass and the photo ID and confirms the quantity handed over (API).
  await donorVerifiesRepresentative(donor, pickupId, passToken);
  const donorSide = await donor.call('POST', '/pickups/confirm-handover', { pickupId, quantity });
  expect(donorSide.body.data.outcome).toBe('WAITING');

  // 7. The NGO confirms the same quantity in the UI → two-way confirmed handover.
  await page.reload();
  const checks = page.getByRole('list', { name: 'Verification checks' });
  await expect(checks.getByRole('listitem').filter({ hasText: 'done' })).toHaveCount(2); // QR pass, photo ID
  await expect(page.getByLabel('Quantity received (meals)')).toHaveValue(String(quantity));
  await page.getByRole('button', { name: `Confirm ${quantity} meals received` }).click();
  await expect(page.getByText('Handover confirmed by both sides')).toBeVisible();

  // 8. Billing shows the fee for exactly this collection: quantity × ₹5.
  await page.goto('/ngo/billing');
  const line = page.getByRole('row').filter({ hasText: food });
  await expect(line).toContainText(`${quantity} meals × ${inr(5)}`);
  await expect(line).toContainText(inr(quantity * 5));
  expect(errors).toEqual([]);
});

test('NGO publishes an assistance request and accepts a donor offer that fully covers it', async ({ page }) => {
  const errors = trackPageErrors(page);
  const reason = `E2E shelter dinner ${uniqueTag()}`;
  const quantity = 60;
  await categoryId(); // fail fast if the seed changed

  // 1. The NGO asks donors for food through the form.
  await login(page, ACCOUNTS.rotibank);
  await page.goto('/ngo/assistance/new');
  await page.getByLabel('Food category').selectOption({ label: 'Cooked meals' });
  await page.getByLabel('Quantity').fill(String(quantity));
  await page.getByLabel('Why you need it').fill(reason);
  await page.getByRole('button', { name: 'Publish request' }).click();
  await expect(page).toHaveURL(/\/ngo\/assistance\/[0-9a-f-]{36}$/);
  const requestId = page.url().split('/').pop() as string;
  await expect(page.getByText(reason)).toBeVisible();
  await expect(page.getByText('No offers yet')).toBeVisible();

  // 2. A donor offers all of it (API).
  const donor = await apiAs(ACCOUNTS.annapurna);
  const offerFood = `E2E veg pulao ${uniqueTag()}`;
  const offer = await donor.call('POST', `/assistance-requests/${requestId}/offers`, {
    quantity,
    foodName: offerFood,
    dietaryType: 'VEG',
    pickupAvailableFrom: inMinutes(60),
    pickupDeadline: inMinutes(20 * 60),
    notes: 'E2E offer',
  });
  expect(offer.status).toBe(201);

  // 3. The NGO sees the offer and accepts it, with the fee estimate shown before confirming.
  await page.reload();
  // The offer's row in "Offers from donors" (the one with the offer progress timeline).
  const row = page.getByRole('listitem').filter({ hasText: offerFood }).filter({ has: page.getByRole('list', { name: 'Offer progress' }) });
  await expect(row).toContainText('Annapurna Caterers');
  await expect(row).toContainText(`offered ${quantity} meals`);
  await row.getByRole('button', { name: 'Accept…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept Annapurna Caterers’s offer' });
  await expect(dialog.getByLabel('Quantity to accept (meals)')).toHaveValue(String(quantity));
  await expect(dialog.getByText('Service fee estimate').locator('..')).toContainText(inr(quantity * 5));
  await dialog.getByRole('button', { name: `Accept ${quantity} meals` }).click();
  const accepted = page.getByRole('dialog', { name: 'Offer accepted' });
  await expect(accepted).toContainText(`You accepted ${quantity} meals from Annapurna Caterers`);
  await expect(accepted.getByText('Fee if this collection completes').locator('..')).toContainText(inr(quantity * 5));
  await accepted.getByRole('button', { name: 'Done' }).click();

  // 4. The request reflects the committed quantity and is fulfilled.
  await expect(page.getByText(`of ${quantity} meals committed · fully covered`)).toBeVisible();
  await expect(row).toContainText(`accepted ${quantity}`);
  const after = await donor.call('GET', `/assistance-requests/${requestId}`);
  expect(after.body.data).toMatchObject({ status: 'FULFILLED', quantityCommitted: quantity, quantityRemaining: 0 });

  // 5. The donor confirms the food is ready (API); the NGO sees it reserved and can assign a pickup.
  const offerId = offer.body.data.id as string;
  const confirmed = await donor.call('PATCH', `/offers/${offerId}/confirm`, { confirmedQuantity: quantity, preparedAt: inMinutes(-5), storageType: 'HOT_HELD', safetyConfirmed: true });
  expect(confirmed.status).toBe(200);
  await page.reload();
  await expect(row).toContainText(`confirmed ${quantity}`);
  await expect(row.getByRole('link', { name: 'Assign pickup' })).toBeVisible();
  await expect(page.getByText('Fulfilled', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
