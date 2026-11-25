export type Unit = 'MEALS' | 'PACKETS' | 'BOXES';

export interface RewardRule {
  id: string;
  unit: Unit;
  basis: 'PER_UNIT' | 'PER_ORDER';
  points: number;
  lifetimeThreshold: number;
}

export interface RewardLine {
  ruleId: string;
  basis: 'PER_UNIT' | 'PER_ORDER';
  pointsPerUnit: number;
  units: number;
  points: number;
  description: string;
}

export interface RewardCalculation {
  points: number;
  lines: RewardLine[];
}

/**
 * Computes reward points for ONE verified handover from configurable rules.
 *
 * PER_UNIT rules are progressive brackets over the donor's lifetime verified
 * quantity of that unit. With the current rules (MEALS: 10 points from the
 * first meal, 15 points after 500 lifetime meals) a donor at 480 lifetime
 * meals who hands over 40 earns 20×10 + 20×15 = 500 points.
 *
 * PER_ORDER rules award a flat amount per verified handover (PACKETS/BOXES:
 * 10 points per order).
 *
 * `quantity` must be the two-way confirmed handover quantity — never the
 * requested, offered or allocated quantity.
 */
export function calculateRewardPoints(input: {
  unit: Unit;
  quantity: number;
  lifetimeQuantityBefore: number;
  rules: RewardRule[];
}): RewardCalculation {
  const { unit, quantity, lifetimeQuantityBefore } = input;
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('quantity must be a non-negative integer');
  if (quantity === 0) return { points: 0, lines: [] };
  const rules = input.rules.filter((r) => r.unit === unit);

  const perOrder = rules.filter((r) => r.basis === 'PER_ORDER');
  if (perOrder.length > 0) {
    const rule = perOrder[0] as RewardRule;
    return {
      points: rule.points,
      lines: [{ ruleId: rule.id, basis: 'PER_ORDER', pointsPerUnit: rule.points, units: 1, points: rule.points, description: `${rule.points} points for this verified order` }],
    };
  }

  const brackets = rules.filter((r) => r.basis === 'PER_UNIT').sort((a, b) => a.lifetimeThreshold - b.lifetimeThreshold);
  const lines: RewardLine[] = [];
  const start = lifetimeQuantityBefore;
  const end = lifetimeQuantityBefore + quantity;
  brackets.forEach((rule, i) => {
    const lower = rule.lifetimeThreshold;
    const upper = brackets[i + 1]?.lifetimeThreshold ?? Number.POSITIVE_INFINITY;
    const units = Math.max(0, Math.min(end, upper) - Math.max(start, lower));
    if (units > 0) {
      lines.push({
        ruleId: rule.id,
        basis: 'PER_UNIT',
        pointsPerUnit: rule.points,
        units,
        points: units * rule.points,
        description: `${units} ${unit.toLowerCase()} × ${rule.points} points${lower > 0 ? ` (after ${lower} lifetime ${unit.toLowerCase()})` : ''}`,
      });
    }
  });
  return { points: lines.reduce((sum, l) => sum + l.points, 0), lines };
}

export interface RewardTier {
  name: string;
  minLifetimePoints: number;
}

export function tierFor(lifetimePoints: number, tiers: RewardTier[]): { current: RewardTier | null; next: RewardTier | null } {
  const sorted = [...tiers].sort((a, b) => a.minLifetimePoints - b.minLifetimePoints);
  let current: RewardTier | null = null;
  for (const t of sorted) if (lifetimePoints >= t.minLifetimePoints) current = t;
  const next = sorted.find((t) => t.minLifetimePoints > lifetimePoints) ?? null;
  return { current, next };
}
