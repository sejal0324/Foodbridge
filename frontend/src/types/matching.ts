import type { DistanceSource } from './api';
import type { DietaryRequirement, DietaryType, Unit, Urgency } from './common';

export type RankingStatus = 'RANKED' | 'RANKING_UNAVAILABLE' | 'NO_ELIGIBLE_CANDIDATES' | 'NOT_RUN';
export type MatchResponse = 'NONE' | 'OFFERED' | 'REQUESTED' | 'DECLINED' | 'UNAVAILABLE' | string;

export interface CriterionScore {
  score: number;
  detail: string;
  weight: number;
  contribution: number;
}

export type CriteriaBreakdown = Record<string, CriterionScore>;

export interface IneligibilityReason {
  code: string;
  text: string;
}

/** Item of GET /api/matching/ngos and /api/matching/donors. */
export interface Recommendation {
  candidate: { id: string; name: string; type: 'NGO' | 'DONOR' };
  eligible: boolean;
  ineligibilityReasons: IneligibilityReason[];
  score: number | null;
  rank: number | null;
  rankingStatus: 'RANKED' | 'RANKING_UNAVAILABLE' | 'NOT_RANKED' | string;
  criteria: CriteriaBreakdown | null;
  explanation: string | null;
  limitations: string[] | null;
  distanceKm: number | null;
  distanceSource: DistanceSource | null;
  algorithmVersion: string | null;
  notifiedAt: string | null;
  response: MatchResponse;
  createdAt: string;
}

export interface RecommendationList {
  runId: string | null;
  rankingStatus: RankingStatus;
  items: Recommendation[];
}

/** Item of GET /api/matching/assistance-requests (donor). */
export interface RecommendedAssistanceRequest {
  request: {
    id: string;
    ngoName: string;
    categoryName: string;
    quantityRemaining: number;
    unit: Unit;
    dietaryRequirement: DietaryRequirement;
    urgency: Urgency;
    neededFrom: string;
    neededUntil: string;
  };
  score: number | null;
  rankingStatus: string;
  explanation: string | null;
  limitations: string[] | null;
  criteria: CriteriaBreakdown | null;
  response: MatchResponse;
  distanceKm: number;
  distanceSource: DistanceSource;
}

/** Item of GET /api/matching/donations (NGO). */
export interface RecommendedDonation {
  donation: {
    id: string;
    foodName: string;
    availableQuantity: number;
    unit: Unit;
    dietaryType: DietaryType;
    pickupDeadline: string;
    donorName: string;
    categoryName: string;
  };
  score: number | null;
  rankingStatus: string;
  explanation: string | null;
  limitations: string[] | null;
  criteria: CriteriaBreakdown | null;
  distanceKm: number;
  distanceSource: DistanceSource;
}

/** POST /api/matching/allocate */
export interface AllocationProposal {
  source: 'AI_OPTIMIZER' | 'FALLBACK_FIRST_COME' | 'NONE';
  status: 'OPTIMAL' | 'FEASIBLE' | 'NO_FEASIBLE_ALLOCATION' | 'TIMEOUT' | string;
  allocations: { requestId?: string; offerId?: string; ngoName?: string; donorName?: string; quantity: number; requested?: number; offered?: number }[];
  totalAllocated?: number;
  explanation: string;
  reasons: string[];
}
