import type { AppConfig } from '../config/env.js';
import { hmacSha256Hex, safeEqual } from '../utils/crypto.js';

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super('Online payments are not configured (Razorpay credentials missing).');
    this.name = 'PaymentsNotConfiguredError';
  }
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/**
 * Minimal Razorpay Orders API client. Real payments are possible only when
 * RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are set.
 * Successful payment is recorded only from a signature-verified webhook.
 */
export class RazorpayGateway {
  constructor(
    private readonly cfg: AppConfig['razorpay'],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  get keyId(): string | undefined {
    return this.cfg.keyId;
  }

  async createOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder> {
    if (!this.cfg.enabled || !this.cfg.keyId || !this.cfg.keySecret) throw new PaymentsNotConfiguredError();
    const res = await this.fetchImpl('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt, notes: input.notes }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Razorpay order creation failed (HTTP ${res.status})`);
    return (await res.json()) as RazorpayOrder;
  }

  /** Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.cfg.keySecret) return false;
    return safeEqual(hmacSha256Hex(this.cfg.keySecret, `${orderId}|${paymentId}`), signature);
  }

  /** Webhook signature: HMAC_SHA256(raw body, webhook secret), sent in X-Razorpay-Signature. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.cfg.webhookSecret || !signature) return false;
    return safeEqual(hmacSha256Hex(this.cfg.webhookSecret, rawBody.toString('utf8')), signature);
  }
}
