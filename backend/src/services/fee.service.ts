import type { Database, Queryable } from '../db/database.js';
import { one } from '../db/database.js';
import { calculateServiceFee, type FeeBreakdown } from '../domain/fees.js';
import { notFound } from '../utils/errors.js';
import type { SettingsService } from './settings.service.js';

export interface ActiveFeeRule {
  id: string;
  unit: string;
  amount_per_unit: number;
  currency: string;
}

/** Reads the active fee rule and tax setting; used for estimates and final fee records. */
export class FeeService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  async activeRule(unit: string, q: Queryable = this.db): Promise<ActiveFeeRule> {
    const rule = await one<ActiveFeeRule>(
      q,
      `SELECT id, unit, amount_per_unit, currency FROM service_fee_rules
        WHERE unit = $1 AND is_active AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())`,
      [unit],
    );
    if (!rule) throw notFound(`Active service fee rule for ${unit}`);
    return rule;
  }

  async calculate(unit: string, quantity: number, q: Queryable = this.db): Promise<{ rule: ActiveFeeRule; fee: FeeBreakdown }> {
    const [rule, tax] = await Promise.all([this.activeRule(unit, q), this.settings.get('billing.tax', q)]);
    const fee = calculateServiceFee({
      unit,
      quantity,
      amountPerUnit: rule.amount_per_unit,
      currency: rule.currency,
      tax: { enabled: tax.enabled, name: tax.name, ratePercent: tax.rate_percent },
    });
    return { rule, fee };
  }

  /** Estimate shown to an NGO before it requests or accepts food. The final fee uses the verified handover quantity. */
  async estimate(unit: string, quantity: number) {
    const { fee } = await this.calculate(unit, quantity);
    return {
      ...fee,
      isEstimate: true,
      note: 'Estimate only. The final service fee is calculated from the quantity confirmed by both sides at handover. Nothing is charged for cancelled, rejected, expired or unsuccessful collections. Donors are never charged.',
    };
  }
}
