import type { Unit } from './common';

/** GET /api/billing/fee-estimate */
export interface FeeEstimate {
  unit: Unit;
  quantity: number;
  unitAmount: number;
  baseAmount: number;
  tax: { applied: boolean; name: string | null; ratePercent: number; amount: number };
  totalAmount: number;
  currency: string;
  isEstimate: boolean;
  note: string;
}
