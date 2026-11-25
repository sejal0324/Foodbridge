# NGO Service Fees and Billing

**Donors pay nothing.** NGOs pay a transparent service fee for successful collections.
Implementation: [`domain/fees.ts`](../backend/src/domain/fees.ts), [`services/fee.service.ts`](../backend/src/services/fee.service.ts),
[`services/billing.service.ts`](../backend/src/services/billing.service.ts) and [`integrations/razorpay.ts`](../backend/src/integrations/razorpay.ts).

## Confirmed fee model (2026-11-03)

- **₹5 per successfully redistributed meal, packet or box**, using the quantity **both sides confirmed at handover**.
- Example: 40 meals handed over and confirmed → base fee **₹200**, before any applicable tax.

| Rule | Implementation |
|---|---|
| Fee shown before commitment | `feeEstimate` on `POST /donations/:id/requests` and `PATCH /offers/:id/accept`, plus `GET /billing/fee-estimate`. Labelled as an estimate |
| Final fee only after a confirmed handover | `ngo_billing` rows are created only inside the handover-confirmation transaction (or when an admin resolves a dispute) |
| Nothing for cancelled, rejected, expired or failed collections | Those never reach a confirmed handover. The service also refuses cancelled or expired allocations |
| No duplicates | Unique `allocation_id`, `handover_record_id` and `idempotency_key` (`handover:{id}:fee`) |
| Exact money | Calculated in integer paise and stored as `numeric(12,2)`. CHECK constraints enforce `base = unit × qty` and `total = base + tax` |
| Auditable ledger | Every fee line, invoice, payment and rule change is audited |

## Tax (GST)

- Configured in `platform_settings['billing.tax'] = { enabled, name, rate_percent }`. **It is disabled by default.**
- The base fee and the tax are stored separately (`base_amount`, `tax_name`, `tax_rate_percent`, `tax_amount`, `total_amount`),
  so a change in tax treatment never alters the base fee.
- **Production tax treatment (GST applicability, registration, HSN/SAC codes, invoice format) must be validated by a
  qualified professional before go-live.** FoodBridge only provides the configuration.

## Invoices

`POST /api/admin/invoices/generate {periodStart, periodEnd}` groups an NGO's `PENDING` fee lines in the period into one
invoice (`FB-INV-YYYY-NNNNNN`, due after `billing.invoice_due_days`), marks the lines `INVOICED` and notifies the NGO.
It is idempotent per NGO and period: an NGO that already has an invoice for exactly that period is skipped (logged, no
invoice number consumed) while the other NGOs in the same run are still invoiced. Fee lines created after an NGO's
invoice for a period stay `PENDING` and are picked up by a later run for a different period. NGOs and admins can
download the invoice as a PDF.

**Revenue figures** (admin analytics, `serviceFeeRevenue`): `billed` is every non-void fee line (invoiced or not),
`collected` is money actually received (successful Razorpay and manual payments, including partial payments), and
`outstanding` is `billed − collected`.

## Payments

| Mode | Behaviour |
|---|---|
| **Razorpay** (enabled only when `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are all set) | `POST /billing/payments` creates an order for the outstanding amount. The checkout callback is signature-verified and only marks the payment `PENDING`. **The payment is marked `SUCCEEDED` only from a signature-verified `payment.captured` webhook** whose amount matches, de-duplicated by event id. A failure is recorded as `FAILED` and the invoice stays payable |
| **Not configured** | `503 PAYMENTS_NOT_CONFIGURED`, clearly explained. Successful payment is never faked |
| **Manual** (admin) | `POST /admin/payments/manual` records an offline payment (a bank transfer reference). It is labelled `MANUAL`, audited and cannot exceed the outstanding amount |

When the succeeded payments cover the invoice total, the invoice and its lines become `PAID`.

**To enable Razorpay:** create keys in the Razorpay dashboard, set the three variables, configure a webhook
`https://<your-domain>/api/billing/webhooks/razorpay` for `payment.captured` and `payment.failed` with the same secret,
and serve over HTTPS. Status: verified with the provider HTTP mocked; **not yet verified with live Razorpay credentials.**

## Configuration

`POST /api/admin/fee-rules {unit, amountPerUnit}` replaces the active rule for a unit. History is kept, and a new rule
affects only future handovers.
