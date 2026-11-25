import type { Unit } from './common';

export interface RewardRuleSummary {
  unit: Unit;
  basis: 'PER_UNIT' | 'PER_ORDER';
  points: number;
  lifetimeThreshold: number;
}

/** GET /api/rewards/balance */
export interface RewardBalance {
  balance: number;
  lifetimePoints: number;
  lifetimeMeals: number;
  lifetimeOrders: number;
  tier: { name: string; benefits?: string } | null;
  nextTier: { name: string; pointsNeeded: number } | null;
  nextRateUpgrade: { mealsNeeded: number; pointsPerMeal: number } | null;
  rules: RewardRuleSummary[];
}

export interface RewardCalculationLine {
  ruleId?: string;
  basis: 'PER_UNIT' | 'PER_ORDER';
  pointsPerUnit: number;
  units: number;
  points: number;
  description: string;
}

/** GET /api/rewards/history item. */
export interface RewardTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT' | 'REVERSAL' | string;
  points: number;
  balanceAfter: number;
  unit: Unit | null;
  quantity: number | null;
  referenceType: string | null;
  referenceId: string | null;
  calculation: { lines?: RewardCalculationLine[]; lifetimeMealsBefore?: number } | null;
  description: string | null;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  donorName: string;
  isYou: boolean;
  points: number;
  mealsRedistributed: number;
}

export interface ImpactCertificate {
  id: string;
  certificateNumber: string;
  periodStart: string;
  periodEnd: string;
  mealsRedistributed: number;
  ordersCompleted: number;
  pointsEarned: number;
  issuedAt: string;
}
