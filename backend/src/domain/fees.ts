export interface TaxSetting {
  enabled: boolean;
  name: string;
  ratePercent: number;
}

export interface FeeBreakdown {
  unit: string;
  quantity: number;
  unitAmount: number;
  baseAmount: number;
  tax: { applied: boolean; name: string | null; ratePercent: number; amount: number };
  totalAmount: number;
  currency: string;
}

const toPaise = (rupees: number) => Math.round(rupees * 100);
const toRupees = (paise: number) => paise / 100;

/**
 * NGO service fee for a quantity of meals/packets/boxes. Computed in integer
 * paise to avoid floating-point drift. The base fee and the tax are kept
 * separate; tax is applied only when the configurable tax setting is enabled
 * (production tax treatment requires professional validation).
 *
 * Example: 40 meals × ₹5 = ₹200.00 base; with tax disabled the total is ₹200.00.
 */
export function calculateServiceFee(input: {
  unit: string;
  quantity: number;
  amountPerUnit: number;
  currency: string;
  tax: TaxSetting;
}): FeeBreakdown {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new Error('quantity must be a non-negative integer');
  const unitPaise = toPaise(input.amountPerUnit);
  const basePaise = unitPaise * input.quantity;
  const applied = input.tax.enabled && input.tax.ratePercent > 0;
  // Round half up to the nearest paisa.
  const taxPaise = applied ? Math.floor((basePaise * input.tax.ratePercent) / 100 + 0.5) : 0;
  return {
    unit: input.unit,
    quantity: input.quantity,
    unitAmount: toRupees(unitPaise),
    baseAmount: toRupees(basePaise),
    tax: { applied, name: applied ? input.tax.name : null, ratePercent: applied ? input.tax.ratePercent : 0, amount: toRupees(taxPaise) },
    totalAmount: toRupees(basePaise + taxPaise),
    currency: input.currency,
  };
}
