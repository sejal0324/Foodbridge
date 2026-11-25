import { expect, test } from '@playwright/test';
import { ACCOUNTS, ADMIN, apiAs, createDonation, donorVerifiesRepresentative, inr, istDate, login, trackPageErrors, uniqueTag } from './helpers.js';

/**
 * Admin side through the real UI; donors' and NGOs' steps are arranged through
 * the API. Uses Seva Sadan Trust (security.spec.ts relies on Green Leaf staying
 * pending) and the Mumbai / Bengaluru organisations, which no other spec uses.
 */

/** A collection up to both handover confirmations (API): donor lists → NGO requests → approve → assign → pass → donor verifies → both confirm. */
async function arrangeHandover(donorEmail: string, ngoEmail: string, food: string, donorQuantity: number, ngoQuantity: number) {
  const donor = await apiAs(donorEmail);
  const ngo = await apiAs(ngoEmail);
  const donationId = await createDonation(donor, food, donorQuantity);
  const request = await ngo.call('POST', `/donations/${donationId}/requests`, { quantity: donorQuantity });
  expect(request.status).toBe(201);
  expect((await donor.call('PATCH', `/requests/${request.body.data.id}/approve`, {})).status).toBe(200);
  const allocation = (await ngo.call('GET', '/allocations')).body.data.find((a: { donationId: string }) => a.donationId === donationId);
  const assigned = await ngo.call('POST', '/pickups/assign', { allocationId: allocation.id, representativeId: ngo.user.representative?.id });
  expect(assigned.status).toBe(201);
  const pickupId = assigned.body.data.id as string;
  const pass = await ngo.call('POST', '/pickups/generate-pass', { pickupId });
  await donorVerifiesRepresentative(donor, pickupId, pass.body.data.token);
  expect((await donor.call('POST', '/pickups/confirm-handover', { pickupId, quantity: donorQuantity })).body.data.outcome).toBe('WAITING');
  const ngoSide = await ngo.call('POST', '/pickups/confirm-handover', { pickupId, quantity: ngoQuantity });
  return { donor, ngo, pickupId, outcome: ngoSide.body.data.outcome as string };
}

test('admin approves a pending NGO and its owner session becomes approved', async ({ page }) => {
  const errors = trackPageErrors(page);
  expect((await apiAs(ACCOUNTS.sevaSadan)).user.organization).toMatchObject({ verificationStatus: 'PENDING' });

  await login(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/admin/verifications');
  const row = page.getByRole('row').filter({ hasText: 'Seva Sadan Trust' });
  await expect(row).toContainText(ACCOUNTS.sevaSadan);
  await row.getByRole('button', { name: 'Review Seva Sadan Trust' }).click();
  await page.getByRole('region', { name: 'Decision' }).getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve Seva Sadan Trust?' });
  await dialog.getByLabel('Notes').fill('E2E: registration checked');
  await dialog.getByRole('button', { name: 'Approve organisation' }).click();
  await expect(page.getByText('Organisation approved').first()).toBeVisible();
  await expect(row).toHaveCount(0); // left the pending queue

  const after = await apiAs(ACCOUNTS.sevaSadan);
  expect(after.user.organization).toMatchObject({ type: 'NGO', name: 'Seva Sadan Trust', verificationStatus: 'APPROVED' });
  // Security spec's pending donor is untouched.
  expect((await apiAs(ACCOUNTS.greenLeaf)).user.organization).toMatchObject({ verificationStatus: 'PENDING' });
  expect(errors).toEqual([]);
});

test('admin resolves a quantity-mismatch dispute and it leaves the open list', async ({ page }) => {
  const errors = trackPageErrors(page);
  const food = `E2E disputed rice ${uniqueTag()}`;
  const { ngo, outcome } = await arrangeHandover(ACCOUNTS.mumbaiDonor, ACCOUNTS.mumbaiNgo, food, 30, 26);
  expect(outcome).toBe('DISPUTED');

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/disputes');
  const row = page.getByRole('row').filter({ hasText: food });
  await expect(row).toContainText('Sea Breeze Kitchen → Mumbai Meal Mission');
  await row.getByRole('button', { name: `Resolve dispute for ${food}` }).click();

  const dialog = page.getByRole('dialog', { name: `Resolve the dispute for ${food}` });
  await expect(dialog).toContainText('Sea Breeze Kitchen says 30 meals');
  await expect(dialog).toContainText('Mumbai Meal Mission says 26 meals');
  await expect(dialog).toContainText('allocated 30 meals');
  await dialog.getByRole('button', { name: /Use NGO.s figure \(26\)/ }).click();
  await expect(dialog.getByLabel('Confirmed quantity')).toHaveValue('26');
  await dialog.getByLabel('Resolution').fill('E2E: recount confirmed 26 meals at the shelter');
  await dialog.getByRole('button', { name: 'Confirm quantity' }).click();
  await expect(page.getByText('Dispute resolved').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0); // no longer open

  await page.getByRole('tab', { name: 'Resolved' }).click();
  await expect(row).toContainText('Confirmed 26');
  // The resolution recorded the NGO fee from the agreed quantity, exactly once.
  const history = await ngo.call('GET', '/billing/history');
  const lines = history.body.data.filter((l: { foodName: string }) => l.foodName === food);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ billableQuantity: 26, totalAmount: 26 * 5 });
  expect(errors).toEqual([]);
});

test('admin invoices a confirmed collection, records a partial offline payment and sees it as collected', async ({ page }) => {
  const errors = trackPageErrors(page);
  const food = `E2E bisi bele bath ${uniqueTag()}`;
  const { outcome } = await arrangeHandover(ACCOUNTS.bengaluruDonor, ACCOUNTS.bengaluruNgo, food, 20, 20);
  expect(outcome).toBe('CONFIRMED');
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const collectedBefore = Number((await admin.call('GET', '/analytics/admin')).body.data.serviceFeeRevenue.collected);
  const partial = 40;

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/billing');

  // 1. Generate invoices for yesterday–today (IST), so the run never depends on the time of day.
  await page.getByLabel(/^From/).fill(istDate(-1));
  await page.getByLabel(/^To/).fill(istDate(0));
  await page.getByRole('button', { name: 'Generate invoices', exact: true }).click();
  await page.getByRole('dialog', { name: 'Generate invoices for this period?' }).getByRole('button', { name: 'Generate', exact: true }).click();
  const generated = page.getByRole('region', { name: 'Generated invoices' });
  await expect(generated.getByRole('listitem').filter({ hasText: 'Bengaluru Food Circle' })).toContainText(inr(20 * 5));
  await generated.getByRole('button', { name: 'Open invoices' }).click();

  // 2. Record a partial offline payment against that invoice.
  const invoice = page.getByRole('row').filter({ hasText: 'Bengaluru Food Circle' });
  await expect(invoice).toContainText(inr(100));
  await invoice.getByRole('button', { name: /Record an offline payment for FB-INV-/ }).click();
  const dialog = page.getByRole('dialog', { name: /Record an offline payment for FB-INV-/ });
  await expect(dialog).toContainText(`outstanding ${inr(100)} of ${inr(100)}`);
  await dialog.getByLabel('Amount received (₹)').fill(String(partial));
  await dialog.getByLabel('Reference').fill('E2E UTR 0042');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Offline payment recorded').first()).toBeVisible();

  // 3. The invoice shows the partial amount, stays open for the rest, and the money counts as collected.
  await expect(invoice.getByRole('cell').nth(3)).toHaveText(inr(partial)); // Paid column
  await expect(invoice).toContainText('Issued');
  await expect(invoice.getByRole('button', { name: /Record an offline payment/ })).toBeVisible();
  const collected = page.getByRole('region', { name: 'Service-fee revenue' }).locator(':scope > div').filter({ hasText: 'Collected' });
  await expect(collected).toContainText(inr(collectedBefore + partial));
  await expect(collected).toContainText('including partial and offline payments'); // the label matches what is counted
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Bengaluru Food Circle' })).toContainText('Offline (manual)');

  await page.goto('/admin');
  const overview = page.locator('dl > div').filter({ has: page.getByText('Collected', { exact: true }) });
  await expect(overview).toContainText(inr(collectedBefore + partial));
  await expect(overview).toContainText('including partial and offline payments');
  expect(errors).toEqual([]);
});
