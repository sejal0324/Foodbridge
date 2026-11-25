import type { Logger } from '../config/logger.js';
import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { PaymentsNotConfiguredError, type RazorpayGateway } from '../integrations/razorpay.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { FeeService } from './fee.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';
import { renderPdf } from './reward.service.js';
import type { SettingsService } from './settings.service.js';

const money = (n: number) => `INR ${n.toFixed(2)}`;

/**
 * Platform service-fee totals, shared by billing and admin analytics so they always agree.
 * "billed" is every non-void fee line (invoiced or not); "collected" is money actually received
 * (successful Razorpay and manual payments, including partial payments); "outstanding" is the rest.
 */
export const SERVICE_FEE_REVENUE_SQL = `SELECT b.billed, p.collected, GREATEST(b.billed - p.collected, 0) AS "outstanding", b.fee_lines AS "feeLines"
   FROM (SELECT COALESCE(sum(total_amount) FILTER (WHERE status <> 'VOID'), 0) AS billed, count(*)::int AS fee_lines FROM ngo_billing) b,
        (SELECT COALESCE(sum(amount), 0) AS collected FROM payments WHERE status = 'SUCCEEDED') p`;

/**
 * NGO service-fee ledger, invoices and payments. Donors are never charged.
 * A fee line is created only from a two-way CONFIRMED handover, at most once
 * per collection (unique allocation, handover and idempotency key).
 */
export class BillingService {
  constructor(
    private readonly db: Database,
    private readonly fees: FeeService,
    private readonly settings: SettingsService,
    private readonly razorpay: RazorpayGateway,
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  /** Records the final fee for a confirmed handover (idempotent; runs inside the handover transaction). */
  async recordFeeForHandover(tx: Queryable, handoverId: string, quantity: number, actor: Actor): Promise<{ id: string; totalAmount: number; duplicate: boolean }> {
    const h = await one<{ status: string; allocation_id: string; ngo_id: string; unit: string; allocation_status: string }>(
      tx,
      `SELECT hr.status, a.id AS allocation_id, a.ngo_id, d.unit, a.status AS allocation_status
         FROM handover_records hr JOIN donation_allocations a ON a.id = hr.allocation_id JOIN donations d ON d.id = a.donation_id WHERE hr.id = $1`,
      [handoverId],
    );
    if (!h) throw notFound('Handover');
    if (h.status !== 'CONFIRMED') throw conflict('Fees are recorded only for a two-way confirmed handover.', 'HANDOVER_NOT_CONFIRMED');
    if (['CANCELLED', 'EXPIRED'].includes(h.allocation_status)) throw conflict('Cancelled or expired collections are never billed.', 'COLLECTION_NOT_BILLABLE');
    const key = `handover:${handoverId}:fee`;
    const existing = await one<{ id: string; total_amount: number }>(tx, 'SELECT id, total_amount FROM ngo_billing WHERE idempotency_key = $1', [key]);
    if (existing) return { id: existing.id, totalAmount: existing.total_amount, duplicate: true };
    const { rule, fee } = await this.fees.calculate(h.unit, quantity, tx);
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO ngo_billing (ngo_id, allocation_id, handover_record_id, fee_rule_id, unit, billable_quantity, unit_amount, base_amount,
                                tax_name, tax_rate_percent, tax_amount, total_amount, currency, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [h.ngo_id, h.allocation_id, handoverId, rule.id, h.unit, quantity, fee.unitAmount, fee.baseAmount, fee.tax.name, fee.tax.ratePercent, fee.tax.amount, fee.totalAmount, fee.currency, key],
    );
    if (!row) {
      const again = await one<{ id: string; total_amount: number }>(tx, 'SELECT id, total_amount FROM ngo_billing WHERE idempotency_key = $1', [key]);
      return { id: again?.id ?? '', totalAmount: again?.total_amount ?? 0, duplicate: true };
    }
    await recordAudit(tx, actor, { action: 'billing.fee_recorded', entityType: 'ngo_billing', entityId: row.id, metadata: { handoverId, ...fee } });
    return { id: row.id, totalAmount: fee.totalAmount, duplicate: false };
  }

  private ngoOf(auth: AuthContext): string {
    if (auth.role !== 'NGO' || !auth.ngoId) throw forbidden('Only NGO owners can view billing.');
    return auth.ngoId;
  }

  async summary(auth: AuthContext) {
    const ngoId = this.ngoOf(auth);
    const totals = await one<{ pending: number; invoiced: number; paid: number; collections: number; quantity: number; month_total: number }>(
      this.db,
      `SELECT COALESCE(sum(total_amount) FILTER (WHERE status = 'PENDING'), 0) AS pending,
              COALESCE(sum(total_amount) FILTER (WHERE status = 'INVOICED'), 0) AS invoiced,
              COALESCE(sum(total_amount) FILTER (WHERE status = 'PAID'), 0) AS paid,
              count(*) FILTER (WHERE status <> 'VOID')::int AS collections,
              COALESCE(sum(billable_quantity) FILTER (WHERE status <> 'VOID'), 0)::int AS quantity,
              COALESCE(sum(total_amount) FILTER (WHERE created_at >= date_trunc('month', now()) AND status <> 'VOID'), 0) AS month_total
         FROM ngo_billing WHERE ngo_id = $1`,
      [ngoId],
    );
    const rules = await many<{ unit: string; amount_per_unit: number; currency: string }>(this.db, 'SELECT unit, amount_per_unit, currency FROM service_fee_rules WHERE is_active ORDER BY unit');
    const tax = await this.settings.get('billing.tax');
    return {
      uninvoicedAmount: totals?.pending ?? 0,
      outstandingInvoicedAmount: totals?.invoiced ?? 0,
      paidAmount: totals?.paid ?? 0,
      thisMonthAmount: totals?.month_total ?? 0,
      billedCollections: totals?.collections ?? 0,
      billedQuantity: totals?.quantity ?? 0,
      currency: 'INR',
      feeRules: rules.map((r) => ({ unit: r.unit, amountPerUnit: r.amount_per_unit, currency: r.currency })),
      tax: { enabled: tax.enabled, name: tax.name, ratePercent: tax.rate_percent },
      onlinePaymentsAvailable: this.razorpay.enabled,
      notes: [
        'Fees are charged only for collections confirmed by both donor and NGO, using the confirmed quantity.',
        'Cancelled, rejected, expired or unsuccessful collections are never charged. Donors are never charged.',
        'Tax treatment shown here is configurable and must be validated professionally before production use.',
      ],
    };
  }

  async history(auth: AuthContext, page: number, pageSize: number) {
    const ngoId = auth.role === 'ADMIN' ? null : this.ngoOf(auth);
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT b.id, b.ngo_id, n.organization_name AS ngo_name, b.allocation_id, b.unit, b.billable_quantity, b.unit_amount, b.base_amount, b.tax_name,
              b.tax_rate_percent, b.tax_amount, b.total_amount, b.currency, b.status, b.invoice_id, b.created_at, d.food_name, dn.business_name AS donor_name
         FROM ngo_billing b JOIN ngos n ON n.id = b.ngo_id JOIN donation_allocations a ON a.id = b.allocation_id JOIN donations d ON d.id = a.donation_id JOIN donors dn ON dn.id = d.donor_id
        WHERE ($1::uuid IS NULL OR b.ngo_id = $1) ORDER BY b.created_at DESC LIMIT $2 OFFSET $3`,
      [ngoId, pageSize, (page - 1) * pageSize],
    );
    const total = await one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM ngo_billing WHERE ($1::uuid IS NULL OR ngo_id = $1)', [ngoId]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        ngo: { id: r.ngo_id, name: r.ngo_name },
        allocationId: r.allocation_id,
        foodName: r.food_name,
        donorName: r.donor_name,
        unit: r.unit,
        billableQuantity: r.billable_quantity,
        unitAmount: r.unit_amount,
        baseAmount: r.base_amount,
        tax: { name: r.tax_name, ratePercent: r.tax_rate_percent, amount: r.tax_amount },
        totalAmount: r.total_amount,
        currency: r.currency,
        status: r.status,
        invoiceId: r.invoice_id,
        createdAt: r.created_at,
      })),
      total: total?.n ?? 0,
    };
  }

  async invoices(auth: AuthContext) {
    const ngoId = auth.role === 'ADMIN' ? null : this.ngoOf(auth);
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT i.id, i.ngo_id, n.organization_name AS ngo_name, i.invoice_number, i.period_start, i.period_end, i.subtotal, i.tax_total, i.total,
              i.currency, i.status, i.issued_at, i.due_at, i.paid_at,
              COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'SUCCEEDED'), 0) AS amount_paid
         FROM invoices i JOIN ngos n ON n.id = i.ngo_id WHERE ($1::uuid IS NULL OR i.ngo_id = $1) ORDER BY i.issued_at DESC NULLS LAST LIMIT 200`,
      [ngoId],
    );
    return rows.map((r) => ({
      id: r.id,
      ngo: { id: r.ngo_id, name: r.ngo_name },
      invoiceNumber: r.invoice_number,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      subtotal: r.subtotal,
      taxTotal: r.tax_total,
      total: r.total,
      amountPaid: r.amount_paid,
      currency: r.currency,
      status: r.status,
      issuedAt: r.issued_at,
      dueAt: r.due_at,
      paidAt: r.paid_at,
    }));
  }

  /**
   * Groups uninvoiced fee lines in a period into one invoice per NGO (admin). Idempotent per NGO + period.
   * Period dates are India (IST) calendar days, whatever the database server's timezone.
   */
  async generateInvoices(periodStart: string, periodEnd: string, actor: Actor) {
    if (periodEnd < periodStart) throw unprocessable('periodEnd must not be before periodStart.', 'INVALID_PERIOD');
    const dueDays = await this.settings.get('billing.invoice_due_days');
    const ngos = await many<{ ngo_id: string }>(
      this.db,
      `SELECT DISTINCT ngo_id FROM ngo_billing WHERE status = 'PENDING' AND created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      [periodStart, periodEnd],
    );
    const created: { invoiceId: string; ngoId: string; total: number }[] = [];
    const notices: (NotificationRow | null)[] = [];
    for (const { ngo_id } of ngos) {
      const result = await this.db.transaction(async (tx) => {
        const lines = await many<{ id: string; base_amount: number; tax_amount: number }>(
          tx,
          `SELECT id, base_amount, tax_amount FROM ngo_billing WHERE ngo_id = $1 AND status = 'PENDING' AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') FOR UPDATE`,
          [ngo_id, periodStart, periodEnd],
        );
        if (lines.length === 0) return null;
        // Already invoiced for this exact period: skip this NGO without failing the whole run, and
        // without consuming an invoice number. Its newer PENDING lines are picked up by a later run
        // for a different period. (ON CONFLICT below still guards a concurrent insert.)
        const existing = await one(tx, 'SELECT 1 FROM invoices WHERE ngo_id = $1 AND period_start = $2 AND period_end = $3', [ngo_id, periodStart, periodEnd]);
        if (existing) {
          this.logger.info({ ngoId: ngo_id, periodStart, periodEnd }, 'invoice for this period already exists; skipped');
          return null;
        }
        const subtotalPaise = lines.reduce((s, l) => s + Math.round(l.base_amount * 100), 0);
        const taxPaise = lines.reduce((s, l) => s + Math.round(l.tax_amount * 100), 0);
        const seq = await one<{ n: number }>(tx, `SELECT nextval('invoice_number_seq') AS n`);
        const number = `FB-INV-${periodStart.slice(0, 4)}-${String(seq?.n ?? 0).padStart(6, '0')}`;
        const inv = await one<{ id: string }>(
          tx,
          `INSERT INTO invoices (ngo_id, invoice_number, period_start, period_end, subtotal, tax_total, total, status, issued_at, due_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', now(), now() + make_interval(days => $8), $9)
           ON CONFLICT (ngo_id, period_start, period_end) DO NOTHING RETURNING id`,
          [ngo_id, number, periodStart, periodEnd, subtotalPaise / 100, taxPaise / 100, (subtotalPaise + taxPaise) / 100, dueDays, actor.userId],
        );
        if (!inv) {
          this.logger.info({ ngoId: ngo_id, periodStart, periodEnd }, 'invoice for this period already exists; skipped');
          return null;
        }
        await tx.query(`UPDATE ngo_billing SET status = 'INVOICED', invoice_id = $2 WHERE id = ANY($1::uuid[])`, [lines.map((l) => l.id), inv.id]);
        await recordAudit(tx, actor, { action: 'billing.invoice_issued', entityType: 'invoice', entityId: inv.id, metadata: { number, lines: lines.length } });
        const owner = await one<{ owner_user_id: string }>(tx, 'SELECT owner_user_id FROM ngos WHERE id = $1', [ngo_id]);
        const n = await this.notifications.create(tx, {
          userId: owner?.owner_user_id as string,
          type: 'INVOICE_ISSUED',
          title: `Invoice ${number} issued`,
          body: `Your FoodBridge service-fee invoice for ${periodStart} to ${periodEnd} is ${money((subtotalPaise + taxPaise) / 100)}.`,
          linkPath: '/ngo/billing',
          dedupeKey: `invoice:${inv.id}`,
          email: true,
        });
        return { invoice: { invoiceId: inv.id, ngoId: ngo_id, total: (subtotalPaise + taxPaise) / 100 }, n };
      });
      if (result) {
        created.push(result.invoice);
        notices.push(result.n);
      }
    }
    this.notifications.publish(notices);
    return created;
  }

  async invoicePdf(auth: AuthContext, invoiceId: string): Promise<{ buffer: Buffer; number: string }> {
    const inv = await one<Record<string, unknown>>(
      this.db,
      `SELECT i.*, n.organization_name, n.address_line, n.city, n.registration_number FROM invoices i JOIN ngos n ON n.id = i.ngo_id WHERE i.id = $1`,
      [invoiceId],
    );
    if (!inv || (auth.role !== 'ADMIN' && inv.ngo_id !== auth.ngoId)) throw notFound('Invoice');
    const lines = await many<Record<string, unknown>>(
      this.db,
      `SELECT b.created_at, d.food_name, b.unit, b.billable_quantity, b.unit_amount, b.base_amount, b.tax_amount, b.total_amount
         FROM ngo_billing b JOIN donation_allocations a ON a.id = b.allocation_id JOIN donations d ON d.id = a.donation_id WHERE b.invoice_id = $1 ORDER BY b.created_at`,
      [invoiceId],
    );
    const buffer = await renderPdf((doc) => {
      doc.fillColor('#2E7D32').fontSize(22).text('FoodBridge AI', { continued: true }).fillColor('#333').fontSize(12).text('   Service-fee invoice');
      doc.moveDown().fontSize(10).fillColor('#000');
      doc.text(`Invoice: ${inv.invoice_number as string}`);
      doc.text(`Period: ${inv.period_start as string} to ${inv.period_end as string}`);
      doc.text(`Issued: ${(inv.issued_at as Date | null)?.toISOString().slice(0, 10) ?? '-'}   Due: ${(inv.due_at as Date | null)?.toISOString().slice(0, 10) ?? '-'}`);
      doc.text(`Status: ${inv.status as string}`);
      doc.moveDown().text(`Billed to: ${inv.organization_name as string}`);
      if (inv.address_line || inv.city) doc.text([inv.address_line, inv.city].filter(Boolean).join(', '));
      doc.moveDown();
      doc.font('Helvetica-Bold').text('Date        Item                                   Qty      Rate      Base       Tax       Total').font('Helvetica');
      for (const l of lines) {
        const row = [
          (l.created_at as Date).toISOString().slice(0, 10).padEnd(12),
          `${String(l.food_name).slice(0, 26)} (${String(l.unit).toLowerCase()})`.padEnd(38),
          String(l.billable_quantity).padStart(5),
          (l.unit_amount as number).toFixed(2).padStart(9),
          (l.base_amount as number).toFixed(2).padStart(10),
          (l.tax_amount as number).toFixed(2).padStart(9),
          (l.total_amount as number).toFixed(2).padStart(10),
        ].join(' ');
        doc.font('Courier').fontSize(8).text(row).font('Helvetica').fontSize(10);
      }
      doc.moveDown();
      doc.text(`Subtotal (base service fee): ${money(inv.subtotal as number)}`, { align: 'right' });
      doc.text(`Tax: ${money(inv.tax_total as number)}`, { align: 'right' });
      doc.font('Helvetica-Bold').text(`Total: ${money(inv.total as number)}`, { align: 'right' }).font('Helvetica');
      doc.moveDown(2).fontSize(8).fillColor('#666').text(
        'Fees apply only to collections confirmed by both donor and NGO, using the confirmed quantity. Donors are never charged. Tax treatment is configurable and requires professional validation before production use.',
      );
    });
    return { buffer, number: inv.invoice_number as string };
  }

  // --- Payments ---------------------------------------------------------------

  private async outstanding(q: Queryable, invoiceId: string) {
    const inv = await one<{ id: string; ngo_id: string; total: number; status: string; invoice_number: string; currency: string; paid: number }>(
      q,
      `SELECT i.id, i.ngo_id, i.total, i.status, i.invoice_number, i.currency,
              COALESCE((SELECT sum(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'SUCCEEDED'), 0) AS paid
         FROM invoices i WHERE i.id = $1`,
      [invoiceId],
    );
    if (!inv) throw notFound('Invoice');
    return { ...inv, due: Math.round((inv.total - inv.paid) * 100) / 100 };
  }

  /** Starts an online payment (Razorpay order). Never marks anything paid by itself. */
  async createPayment(auth: AuthContext, invoiceId: string, actor: Actor) {
    const ngoId = this.ngoOf(auth);
    const inv = await this.outstanding(this.db, invoiceId);
    if (inv.ngo_id !== ngoId) throw notFound('Invoice');
    if (inv.status === 'PAID' || inv.due <= 0) throw conflict('This invoice is already paid.', 'INVOICE_PAID');
    if (inv.status === 'VOID') throw conflict('This invoice is void.', 'INVOICE_VOID');
    if (!this.razorpay.enabled) {
      throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payment is not configured on this FoodBridge instance. The invoice stays payable; an administrator can record a bank transfer or other manual payment.');
    }
    // One open online order per invoice: reuse it (e.g. a second tab or a retry) instead of creating another
    // order that could be paid as well. A checkout already awaiting the provider's confirmation blocks a new one.
    const open = await one<{ provider_order_id: string; amount: number; status: string }>(
      this.db,
      `SELECT provider_order_id, amount, status FROM payments WHERE invoice_id = $1 AND provider = 'RAZORPAY' AND status IN ('CREATED', 'PENDING') ORDER BY created_at DESC LIMIT 1`,
      [invoiceId],
    );
    if (open?.status === 'PENDING') {
      throw conflict('A payment for this invoice is being confirmed by the payment provider. Please wait a few minutes before trying again.', 'PAYMENT_IN_PROGRESS');
    }
    if (open && Math.round(open.amount * 100) === Math.round(inv.due * 100)) {
      return { provider: 'RAZORPAY', keyId: this.razorpay.keyId, orderId: open.provider_order_id, amount: inv.due, amountPaise: Math.round(inv.due * 100), currency: inv.currency, invoiceNumber: inv.invoice_number };
    }
    if (open) {
      // The amount due changed (e.g. a manual part-payment); retire the stale order before creating a new one.
      await this.db.query(`UPDATE payments SET status = 'FAILED', failure_reason = 'superseded by a new order for the updated amount' WHERE provider_order_id = $1 AND status = 'CREATED'`, [open.provider_order_id]);
    }
    let order;
    try {
      order = await this.razorpay.createOrder({ amountPaise: Math.round(inv.due * 100), currency: inv.currency, receipt: inv.invoice_number, notes: { invoiceId, ngoId } });
    } catch (err) {
      if (err instanceof PaymentsNotConfiguredError) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', err.message);
      this.logger.error({ err }, 'razorpay order failed');
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment provider could not create an order. The invoice remains unpaid; try again later.');
    }
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments (ngo_id, invoice_id, provider, provider_order_id, amount, currency, status, idempotency_key)
         VALUES ($1, $2, 'RAZORPAY', $3, $4, $5, 'CREATED', $6)`,
        [ngoId, invoiceId, order.id, inv.due, inv.currency, `rzp-order:${order.id}`],
      );
      await recordAudit(tx, actor, { action: 'billing.payment_started', entityType: 'invoice', entityId: invoiceId, metadata: { orderId: order.id, amount: inv.due } });
    });
    return { provider: 'RAZORPAY', keyId: this.razorpay.keyId, orderId: order.id, amount: inv.due, amountPaise: Math.round(inv.due * 100), currency: inv.currency, invoiceNumber: inv.invoice_number };
  }

  /** Checkout callback: verifies the signature and marks the payment PENDING until the webhook confirms capture. */
  async verifyCheckout(auth: AuthContext, input: { orderId: string; paymentId: string; signature: string }, actor: Actor) {
    const ngoId = this.ngoOf(auth);
    if (!this.razorpay.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
      await recordAudit(this.db, actor, { action: 'billing.checkout_signature_invalid', entityType: 'payment', metadata: { orderId: input.orderId } });
      throw badRequest('Payment signature verification failed.', undefined, 'INVALID_PAYMENT_SIGNATURE');
    }
    const res = await this.db.query(
      `UPDATE payments SET status = 'PENDING', provider_payment_id = $2 WHERE provider_order_id = $1 AND ngo_id = $3 AND status = 'CREATED'`,
      [input.orderId, input.paymentId, ngoId],
    );
    return { status: res.rowCount ? 'PENDING_CONFIRMATION' : 'UNCHANGED', message: 'Payment received by the provider; it will show as paid once the provider confirms capture.' };
  }

  /** Razorpay webhook: signature-verified and de-duplicated by event id. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): Promise<{ handled: boolean; reason?: string }> {
    if (!this.razorpay.enabled) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Payments are not configured.');
    if (!this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      await recordAudit(this.db, { type: 'SERVICE', userId: null, role: null }, { action: 'billing.webhook_signature_invalid', entityType: 'payment' });
      throw badRequest('Invalid webhook signature.', undefined, 'INVALID_WEBHOOK_SIGNATURE');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; status: string; error_description?: string } } };
    };
    const key = eventId ?? `${event.event}:${event.payload?.payment?.entity?.id ?? 'unknown'}`;
    const notices: (NotificationRow | null)[] = [];
    const result = await this.db.transaction(async (tx): Promise<{ handled: boolean; reason?: string }> => {
      const fresh = await one<{ id: string }>(
        tx,
        `INSERT INTO idempotency_records (scope, key, request_hash, status, expires_at) VALUES ('razorpay.webhook', $1, 'n/a', 'COMPLETED', now() + interval '30 days')
         ON CONFLICT (scope, key) DO NOTHING RETURNING id`,
        [key.slice(0, 200)],
      );
      if (!fresh) return { handled: false, reason: 'duplicate event' };
      const p = event.payload?.payment?.entity;
      if (!p) return { handled: false, reason: 'no payment entity' };
      const ref = await one<{ invoice_id: string }>(tx, 'SELECT invoice_id FROM payments WHERE provider_order_id = $1', [p.order_id]);
      if (!ref) return { handled: false, reason: 'unknown order' };
      // Lock order: invoice, then payment (as manual payments do), so settlement is serialised per invoice.
      await tx.query('SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE', [ref.invoice_id]);
      const payment = await one<{ id: string; invoice_id: string; status: string; amount: number }>(
        tx,
        'SELECT id, invoice_id, status, amount FROM payments WHERE provider_order_id = $1 FOR UPDATE',
        [p.order_id],
      );
      if (!payment) return { handled: false, reason: 'unknown order' };
      if (event.event === 'payment.captured') {
        if (Math.round(payment.amount * 100) !== p.amount) {
          this.logger.error({ paymentId: payment.id }, 'captured amount does not match order amount');
          return { handled: false, reason: 'amount mismatch' };
        }
        if (payment.status === 'SUCCEEDED') return { handled: false, reason: 'payment already recorded' };
        const before = await this.outstanding(tx, payment.invoice_id);
        const excess = Math.round((payment.amount - Math.max(before.due, 0)) * 100) / 100;
        // The money was really captured, so it is recorded as received. If the invoice was already (partly)
        // covered meanwhile, the excess is flagged for a refund and the admins are alerted.
        const note = excess > 0.001 ? `OVERPAYMENT: ${money(excess)} above the amount due; refund required` : null;
        await tx.query(`UPDATE payments SET status = 'SUCCEEDED', provider_payment_id = $2, succeeded_at = now(), reference_note = COALESCE($3, reference_note) WHERE id = $1`, [payment.id, p.id, note]);
        if (note) {
          this.logger.error({ paymentId: payment.id, invoiceId: payment.invoice_id, excess }, 'online payment exceeds the amount due');
          await recordAudit(tx, { type: 'SERVICE', userId: null, role: null }, { action: 'billing.overpayment_detected', entityType: 'payment', entityId: payment.id, metadata: { excess } });
          notices.push(
            ...(await this.notifications.notifyAdmins(tx, {
              type: 'PAYMENT_OVERPAID',
              title: 'Invoice overpaid: refund needed',
              body: `An online payment for invoice ${before.invoice_number} exceeded the amount due by ${money(excess)}. Refund the excess to the NGO.`,
              linkPath: '/admin/billing',
              priority: 'HIGH',
              dedupeKey: `overpaid:${payment.id}`,
            })),
          );
        }
        await this.settleInvoiceIfPaid(tx, payment.invoice_id);
      } else if (event.event === 'payment.failed') {
        await tx.query(`UPDATE payments SET status = 'FAILED', provider_payment_id = $2, failure_reason = $3 WHERE id = $1 AND status <> 'SUCCEEDED'`, [
          payment.id,
          p.id,
          p.error_description ?? 'payment failed',
        ]);
      } else {
        return { handled: false, reason: `ignored event ${event.event}` };
      }
      await recordAudit(tx, { type: 'SERVICE', userId: null, role: null }, { action: `billing.${event.event.replace('.', '_')}`, entityType: 'payment', entityId: payment.id });
      return { handled: true };
    });
    this.notifications.publish(notices);
    return result;
  }

  /** Admin records an offline payment (bank transfer, cheque). Clearly labelled MANUAL and audited. */
  async recordManualPayment(invoiceId: string, amount: number, reference: string, actor: Actor) {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
      const inv = await this.outstanding(tx, invoiceId);
      if (inv.status === 'VOID') throw conflict('This invoice is void.', 'INVOICE_VOID');
      if (amount > inv.due + 0.001) throw unprocessable(`Amount exceeds the outstanding ${money(inv.due)}.`, 'OVERPAYMENT');
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO payments (ngo_id, invoice_id, provider, amount, currency, status, reference_note, recorded_by, idempotency_key, succeeded_at)
         VALUES ($1, $2, 'MANUAL', $3, $4, 'SUCCEEDED', $5, $6, 'manual:' || gen_random_uuid(), now()) RETURNING id`,
        [inv.ngo_id, invoiceId, amount, inv.currency, reference, actor.userId],
      );
      await this.settleInvoiceIfPaid(tx, invoiceId);
      await recordAudit(tx, actor, { action: 'billing.manual_payment_recorded', entityType: 'payment', entityId: row?.id, changes: { invoiceId, amount, reference } });
      return { paymentId: row?.id };
    });
  }

  private async settleInvoiceIfPaid(tx: Queryable, invoiceId: string) {
    const inv = await this.outstanding(tx, invoiceId);
    if (inv.due <= 0.001 && inv.status !== 'PAID') {
      await tx.query(`UPDATE invoices SET status = 'PAID', paid_at = now() WHERE id = $1`, [invoiceId]);
      await tx.query(`UPDATE ngo_billing SET status = 'PAID' WHERE invoice_id = $1`, [invoiceId]);
    }
  }

  async payments(auth: AuthContext) {
    const ngoId = auth.role === 'ADMIN' ? null : this.ngoOf(auth);
    return many(
      this.db,
      `SELECT p.id, p.invoice_id AS "invoiceId", i.invoice_number AS "invoiceNumber", n.organization_name AS "ngoName", p.provider, p.amount, p.currency, p.status,
              p.failure_reason AS "failureReason", p.reference_note AS "referenceNote", p.created_at AS "createdAt", p.succeeded_at AS "succeededAt"
         FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN ngos n ON n.id = p.ngo_id
        WHERE ($1::uuid IS NULL OR p.ngo_id = $1) ORDER BY p.created_at DESC LIMIT 200`,
      [ngoId],
    );
  }

  // --- Admin fee configuration --------------------------------------------------

  async feeRules() {
    return many(this.db, 'SELECT id, unit, amount_per_unit AS "amountPerUnit", currency, description, effective_from AS "effectiveFrom", effective_to AS "effectiveTo", is_active AS "isActive" FROM service_fee_rules ORDER BY unit, effective_from DESC');
  }

  async setFeeRule(unit: string, amountPerUnit: number, description: string | undefined, actor: Actor) {
    return this.db.transaction(async (tx) => {
      await tx.query('UPDATE service_fee_rules SET is_active = false, effective_to = now() WHERE unit = $1 AND is_active', [unit]);
      const row = await one<{ id: string }>(tx, 'INSERT INTO service_fee_rules (unit, amount_per_unit, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [
        unit,
        amountPerUnit,
        description ?? null,
        actor.userId,
      ]);
      await recordAudit(tx, actor, { action: 'billing.fee_rule_changed', entityType: 'service_fee_rule', entityId: row?.id, changes: { unit, amountPerUnit } });
      return row;
    });
  }

  async revenue() {
    return one(this.db, SERVICE_FEE_REVENUE_SQL);
  }
}
