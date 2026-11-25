import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RazorpayGateway } from '../src/integrations/razorpay.js';
import { hmacSha256Hex } from '../src/utils/crypto.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { confirmBoth, pickupFixture, verifyPickup } from './helpers/pickup.js';

const RZP = { keyId: 'rzp_test_dummy', keySecret: 'test-key-secret', webhookSecret: 'test-webhook-secret', enabled: true };
let orderCounter = 0;
const fakeFetch = (async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { amount: number; currency: string; receipt: string };
  return new Response(JSON.stringify({ id: `order_test_${++orderCounter}`, amount: body.amount, currency: body.currency, receipt: body.receipt, status: 'created' }), { status: 200 });
}) as typeof fetch;

let h: Harness;
let paid: Harness;
beforeAll(async () => {
  h = await createHarness();
  paid = await createHarness((c) => ({ ...c, razorpay: RZP }), { razorpay: new RazorpayGateway(RZP, fakeFetch) });
});
beforeEach(async () => {
  await resetDatabase(h.ctx.db);
});
afterAll(async () => {
  await h.close();
  await paid.close();
});

async function billedCollection(x: Harness, qty = 40) {
  const f = await pickupFixture(x, { approve: qty });
  await verifyPickup(x, f);
  await confirmBoth(x, f, qty, qty);
  return f;
}

/** Today's date in India (invoice periods are IST calendar days). */
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

describe('NGO billing ledger and invoices', () => {
  it('shows the fee summary, generates an invoice once, and renders a PDF', async () => {
    const f = await billedCollection(h);
    const summary = await h.http.get('/api/billing/summary').set(f.ngo.auth).expect(200);
    expect(summary.body.data).toMatchObject({ uninvoicedAmount: 200, billedCollections: 1, billedQuantity: 40, onlinePaymentsAvailable: false, tax: { enabled: false } });
    await h.http.get('/api/billing/summary').set(f.donor.auth).expect(403); // donors have no billing
    const gen = await h.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    expect(gen.body.data).toHaveLength(1);
    expect(gen.body.data[0].total).toBe(200);
    const again = await h.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    expect(again.body.data).toHaveLength(0); // nothing uninvoiced left
    const invoices = await h.http.get('/api/billing/invoices').set(f.ngo.auth).expect(200);
    expect(invoices.body.data[0]).toMatchObject({ status: 'ISSUED', total: 200, amountPaid: 0 });
    const pdf = await h.http.get(`/api/billing/invoices/${invoices.body.data[0].id}/pdf`).set(f.ngo.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('applies configurable GST separately from the base fee', async () => {
    const f = await pickupFixture(h, { approve: 40 });
    await h.http.put('/api/admin/settings/billing.tax').set(f.admin.auth).send({ value: { enabled: true, name: 'GST', rate_percent: 18 } }).expect(200);
    await verifyPickup(h, f);
    await confirmBoth(h, f, 40, 40);
    const line = await h.ctx.db.query('SELECT base_amount, tax_name, tax_rate_percent, tax_amount, total_amount FROM ngo_billing');
    expect(line.rows[0]).toEqual({ base_amount: 200, tax_name: 'GST', tax_rate_percent: 18, tax_amount: 36, total_amount: 236 });
    const estimate = await h.http.get('/api/billing/fee-estimate?unit=MEALS&quantity=10').set(f.ngo.auth).expect(200);
    expect(estimate.body.data).toMatchObject({ baseAmount: 50, tax: { applied: true, amount: 9 }, totalAmount: 59 });
  });

  it('never fakes online payment when Razorpay is not configured; admins can record a manual payment', async () => {
    const f = await billedCollection(h);
    await h.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    const inv = (await h.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    const res = await h.http.post('/api/billing/payments').set(f.ngo.auth).send({ invoiceId: inv.id }).expect(503);
    expect(res.body.error.code).toBe('PAYMENTS_NOT_CONFIGURED');
    expect((await h.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0].status).toBe('ISSUED');
    await h.http.post('/api/admin/payments/manual').set(f.admin.auth).send({ invoiceId: inv.id, amount: 500, reference: 'NEFT 1234' }).expect(422); // overpayment
    await h.http.post('/api/admin/payments/manual').set(f.admin.auth).send({ invoiceId: inv.id, amount: 200, reference: 'NEFT UTR 9988' }).expect(201);
    const after = (await h.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    expect(after).toMatchObject({ status: 'PAID', amountPaid: 200 });
    const lines = await h.ctx.db.query(`SELECT DISTINCT status FROM ngo_billing`);
    expect(lines.rows).toEqual([{ status: 'PAID' }]);
  });

  it('skips an NGO already invoiced for the period and still invoices the others, without burning invoice numbers', async () => {
    const first = await billedCollection(h);
    const gen1 = await h.http.post('/api/admin/invoices/generate').set(first.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    expect(gen1.body.data).toHaveLength(1);
    // A late fee line for the same NGO and period (simulated by returning its line to PENDING).
    await h.ctx.db.query(`UPDATE ngo_billing SET status = 'PENDING', invoice_id = NULL`);
    const second = await billedCollection(h);
    const gen2 = await h.http.post('/api/admin/invoices/generate').set(first.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    expect(gen2.body.data).toHaveLength(1);
    expect(gen2.body.data[0].ngoId).toBe(second.ngo.orgId);
    const numbers = await h.ctx.db.query<{ invoice_number: string }>('SELECT invoice_number FROM invoices ORDER BY invoice_number');
    const seq = numbers.rows.map((r) => Number(r.invoice_number.slice(-6)));
    expect(seq).toHaveLength(2);
    expect(seq[1]).toBe((seq[0] ?? 0) + 1); // the skipped NGO consumed no number
    const late = await h.ctx.db.query('SELECT status FROM ngo_billing nb JOIN ngos n ON n.id = nb.ngo_id WHERE n.id = $1', [first.ngo.orgId]);
    expect(late.rows).toEqual([{ status: 'PENDING' }]); // left for a later period, not lost
  });

  it('treats invoice periods as India (IST) calendar days, whatever the database timezone', async () => {
    const f = await billedCollection(h);
    // 00:30 IST today is 19:00 UTC on the previous day.
    await h.ctx.db.query(`UPDATE ngo_billing SET created_at = ($1::date::timestamp + interval '30 minutes') AT TIME ZONE 'Asia/Kolkata'`, [today()]);
    const gen = await h.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    expect(gen.body.data).toHaveLength(1);
  });

  it('counts partial and manual payments as collected in the admin revenue figures', async () => {
    const f = await billedCollection(h);
    await h.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    const inv = (await h.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    await h.http.post('/api/admin/payments/manual').set(f.admin.auth).send({ invoiceId: inv.id, amount: 80, reference: 'NEFT UTR 1111' }).expect(201);
    const partial = (await h.http.get('/api/analytics/admin').set(f.admin.auth).expect(200)).body.data.serviceFeeRevenue;
    expect(partial).toMatchObject({ billed: 200, collected: 80, outstanding: 120 });
    await h.http.post('/api/admin/payments/manual').set(f.admin.auth).send({ invoiceId: inv.id, amount: 120, reference: 'NEFT UTR 2222' }).expect(201);
    const full = (await h.http.get('/api/analytics/admin').set(f.admin.auth).expect(200)).body.data.serviceFeeRevenue;
    expect(full).toMatchObject({ billed: 200, collected: 200, outstanding: 0 });
  });
});

describe('Razorpay integration (credentials configured; provider HTTP mocked)', () => {
  const webhook = (x: Harness, payload: unknown, opts: { secret?: string; eventId?: string } = {}) => {
    const raw = JSON.stringify(payload);
    return x.http
      .post('/api/billing/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', hmacSha256Hex(opts.secret ?? RZP.webhookSecret, raw))
      .set('X-Razorpay-Event-Id', opts.eventId ?? `evt_${Math.random()}`)
      .send(raw);
  };

  it('creates an order, keeps the invoice unpaid until a verified webhook confirms capture, and de-duplicates events', async () => {
    await resetDatabase(paid.ctx.db);
    const f = await billedCollection(paid);
    await paid.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    const inv = (await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    const order = await paid.http.post('/api/billing/payments').set(f.ngo.auth).send({ invoiceId: inv.id }).expect(201);
    expect(order.body.data).toMatchObject({ provider: 'RAZORPAY', amount: 200, amountPaise: 20000, keyId: RZP.keyId });

    // Checkout callback with a valid signature → PENDING only (not paid).
    const paymentId = 'pay_test_123';
    const sig = hmacSha256Hex(RZP.keySecret, `${order.body.data.orderId}|${paymentId}`);
    await paid.http.post('/api/billing/payments/verify').set(f.ngo.auth).send({ orderId: order.body.data.orderId, paymentId, signature: 'bad'.repeat(10) }).expect(400);
    await paid.http.post('/api/billing/payments/verify').set(f.ngo.auth).send({ orderId: order.body.data.orderId, paymentId, signature: sig }).expect(200);
    expect((await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0].status).toBe('ISSUED');

    const captured = { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: order.body.data.orderId, amount: 20000, status: 'captured' } } } };
    const forged = await webhook(paid, captured, { secret: 'wrong-secret' }).expect(400);
    expect(forged.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    expect((await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0].status).toBe('ISSUED');

    const ok = await webhook(paid, captured, { eventId: 'evt_capture_1' }).expect(200);
    expect(ok.body.data.handled).toBe(true);
    const dup = await webhook(paid, captured, { eventId: 'evt_capture_1' }).expect(200);
    expect(dup.body.data).toMatchObject({ handled: false, reason: 'duplicate event' });
    const invoice = (await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    expect(invoice).toMatchObject({ status: 'PAID', amountPaid: 200 });
  });

  it('reuses the open order for an invoice and flags an online payment that arrives after the invoice was settled', async () => {
    await resetDatabase(paid.ctx.db);
    const f = await billedCollection(paid);
    await paid.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    const inv = (await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    const first = await paid.http.post('/api/billing/payments').set(f.ngo.auth).send({ invoiceId: inv.id }).expect(201);
    const second = await paid.http.post('/api/billing/payments').set(f.ngo.auth).send({ invoiceId: inv.id }).expect(201);
    expect(second.body.data.orderId).toBe(first.body.data.orderId); // a second tab or retry reuses the open order
    // An admin records the bank transfer in full; then the stale online checkout is paid as well.
    await paid.http.post('/api/admin/payments/manual').set(f.admin.auth).send({ invoiceId: inv.id, amount: 200, reference: 'NEFT UTR 7777' }).expect(201);
    const captured = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_late_1', order_id: first.body.data.orderId, amount: 20000, status: 'captured' } } } };
    await webhook(paid, captured).expect(200);
    const online = (await paid.ctx.db.query(`SELECT status, reference_note FROM payments WHERE provider = 'RAZORPAY'`)).rows;
    expect(online).toHaveLength(1);
    expect(online[0]?.status).toBe('SUCCEEDED'); // the money really arrived, so it is recorded...
    expect(online[0]?.reference_note).toMatch(/^OVERPAYMENT: INR 200\.00/); // ...and flagged for a refund
    const notes = (await paid.http.get('/api/notifications').set(f.admin.auth).expect(200)).body.data;
    expect(notes.some((n: { type: string }) => n.type === 'PAYMENT_OVERPAID')).toBe(true);
  });

  it('records a failed payment and leaves billing pending', async () => {
    await resetDatabase(paid.ctx.db);
    const f = await billedCollection(paid);
    await paid.http.post('/api/admin/invoices/generate').set(f.admin.auth).send({ periodStart: today(), periodEnd: today() }).expect(201);
    const inv = (await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0];
    const order = await paid.http.post('/api/billing/payments').set(f.ngo.auth).send({ invoiceId: inv.id }).expect(201);
    await webhook(paid, { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_fail_1', order_id: order.body.data.orderId, amount: 20000, status: 'failed', error_description: 'Card declined' } } } }).expect(200);
    const payments = await paid.http.get('/api/billing/payments').set(f.ngo.auth).expect(200);
    expect(payments.body.data[0]).toMatchObject({ status: 'FAILED', failureReason: 'Card declined' });
    expect((await paid.http.get('/api/billing/invoices').set(f.ngo.auth)).body.data[0].status).toBe('ISSUED');
  });
});
