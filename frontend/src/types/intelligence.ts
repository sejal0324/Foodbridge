import type { DataLabel } from './api';
import type { MealPeriod } from './common';

// --- Forecasts ---------------------------------------------------------------
export interface SurplusPrediction {
  date: string;
  mealPeriod: MealPeriod;
  status: 'OK' | 'INSUFFICIENT_HISTORY';
  predictedQuantity: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  basis: 'model' | 'baseline' | null;
}

export interface SurplusForecast {
  status: 'OK' | 'UNAVAILABLE';
  message?: string;
  model?: { name: string; version: string; algorithm: string; trainingDataLabel: DataLabel };
  predictions: SurplusPrediction[];
  limitations?: string[];
  minHistoryDays?: number;
  historyDays: number;
  dataLabel: DataLabel;
  notice?: string;
}

export interface DailyMetric {
  date: string;
  mealPeriod: MealPeriod;
  preparedQty: number;
  soldQty: number;
  surplusQty: number;
  isHoliday: boolean;
  specialEvent: string | null;
  dataSource: 'REAL' | 'SYNTHETIC' | string;
}

export interface DailyMetricInput {
  date: string;
  mealPeriod: MealPeriod;
  preparedQty: number;
  soldQty: number;
  surplusQty: number;
  isHoliday?: boolean;
  specialEvent?: string;
}

export interface ForecastAccuracy {
  comparisons: { date: string; mealPeriod: MealPeriod; predicted: number; actual: number }[];
  meanAbsoluteError: number | null;
  sampleSize: number;
}

// --- Analytics ---------------------------------------------------------------
export interface DonorAnalytics {
  totals: {
    donations: number;
    mealsListed: number;
    mealsRedistributed: number;
    completedCollections: number;
    failedCollections: number;
    openDonations: number;
    expiredDonations: number;
  };
  completionRate: number | null;
  monthly: { month: string; donations: number; quantityRedistributed: number }[];
  categories: { category: string; donations: number; quantity: number }[];
  rewards: { balance: number; lifetimePoints: number };
  dataLabel: DataLabel;
}

export interface Insight {
  type: 'WEEKEND_VS_WEEKDAY' | 'UNMET_DEMAND' | 'DISTANCE_DELAY' | 'TREND' | string;
  title: string;
  body: string;
  sampleSize: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  limitations: string[];
  supportingData: Record<string, unknown>;
}

export interface InsightsResponse {
  status: 'OK' | 'UNAVAILABLE';
  insights: Insight[];
  skipped: { type: string; reason: string }[];
  dataLabel: DataLabel;
  message?: string;
}

/** GET /api/public/impact */
export interface PublicImpact {
  mealsRedistributed: number;
  verifiedHandovers: number;
  verifiedDonors: number;
  verifiedNgos: number;
  beneficiariesServed: number;
  dataLabel: DataLabel;
  generatedAt: string;
}
