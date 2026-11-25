import type { MapMarker } from '@/components/map';
import type { Pickup, Unit } from '@/types';
import { formatNumber, unitLabel } from '@/utils/format';
import { PRE_HANDOVER_PICKUP_STATUSES } from './labels';
import type { CityDistribution, Invoice, RewardRuleRow } from './types';

/** Short marker label for a donation count ("7", "42", "99+"). */
export function markerLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** City markers for the India map (cities without coordinates are only listed in the table). */
export function cityMarkers(rows: CityDistribution[]): MapMarker[] {
  return rows
    .filter((r): r is CityDistribution & { lat: number; lng: number } => typeof r.lat === 'number' && typeof r.lng === 'number')
    .map((r) => ({
      id: `city-${r.city}`,
      position: { lat: r.lat, lng: r.lng },
      kind: 'donor' as const,
      label: markerLabel(r.donations),
      title: `${r.city}: ${formatNumber(r.donations)} donation${r.donations === 1 ? '' : 's'}, ${formatNumber(r.quantity)} units listed`,
    }));
}

/** A pickup still waiting for verification/handover after the donation's pickup deadline. */
export function isOverdue(p: Pick<Pickup, 'status' | 'donation'>, now: number): boolean {
  return PRE_HANDOVER_PICKUP_STATUSES.has(p.status) && Date.parse(p.donation.pickupDeadline) < now;
}

const UNIT_ORDER: Unit[] = ['MEALS', 'PACKETS', 'BOXES'];
const UNIT_NAME: Record<Unit, string> = { MEALS: 'Meals', PACKETS: 'Packets', BOXES: 'Boxes' };

/**
 * Plain-language summary of the active reward rules, one line per unit, e.g.
 * "Meals: 10 points per meal from the first meal, then 15 points per meal after 500 lifetime meals."
 */
export function describeRewardRules(rules: Pick<RewardRuleRow, 'unit' | 'basis' | 'points' | 'lifetimeThreshold' | 'isActive'>[]): { unit: Unit; text: string }[] {
  const active = rules.filter((r) => r.isActive);
  const out: { unit: Unit; text: string }[] = [];
  for (const unit of UNIT_ORDER) {
    const forUnit = active.filter((r) => r.unit === unit);
    if (forUnit.length === 0) {
      out.push({ unit, text: `${UNIT_NAME[unit]}: no active rule, so no points are earned.` });
      continue;
    }
    const perOrder = forUnit.find((r) => r.basis === 'PER_ORDER');
    if (perOrder) {
      out.push({ unit, text: `${UNIT_NAME[unit]}: ${formatNumber(perOrder.points)} points per verified order, whatever the number of ${unitLabel(unit, 2)}.` });
      continue;
    }
    const brackets = forUnit.filter((r) => r.basis === 'PER_UNIT').sort((a, b) => a.lifetimeThreshold - b.lifetimeThreshold);
    const parts = brackets.map((r, i) => {
      const rate = `${formatNumber(r.points)} points per ${unitLabel(unit, 1)}`;
      if (r.lifetimeThreshold === 0) return `${rate} from the first ${unitLabel(unit, 1)}`;
      return `${i === 0 ? '' : 'then '}${rate} after ${formatNumber(r.lifetimeThreshold)} lifetime ${unitLabel(unit, 2)}`;
    });
    out.push({ unit, text: `${UNIT_NAME[unit]}: ${parts.join(', ')}.` });
  }
  return out;
}

/** Amount still due on an invoice (never negative, rounded to paise). */
export function outstandingOf(invoice: Pick<Invoice, 'total' | 'amountPaid'>): number {
  return Math.max(0, Math.round((Number(invoice.total) - Number(invoice.amountPaid)) * 100) / 100);
}
