import { randomUUID } from 'node:crypto';
import type { Logger } from '../config/logger.js';
import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { AiUnavailableError, type AiClient, type MatchResponse, type RankedResult } from '../integrations/ai-client.js';
import { findDonation } from '../repositories/donation.repository.js';
import { type AuthContext, scopedNgoId } from '../types/auth.js';
import { forbidden, notFound } from '../utils/errors.js';
import { formatDateTime, formatKm, formatTime, localClock, unitLabel } from '../utils/format.js';
import type { NotificationRow, NotificationService } from './notification.service.js';
import type { SettingsService } from './settings.service.js';

/** Straight-line travel estimate used only for eligibility (never shown as road time). */
const ESTIMATED_SPEED_M_PER_MIN = 20_000 / 60;
export const ALGORITHM_VERSION = 'weighted-v1';
const FALLBACK_LIMITATION = 'AI ranking was unavailable, so eligible candidates are ordered by straight-line distance only.';

export const INELIGIBILITY_TEXT: Record<string, string> = {
  OUTSIDE_COLLECTION_RADIUS: 'outside the collection radius',
  CATEGORY_NOT_ACCEPTED: 'does not accept this food category',
  DIETARY_INCOMPATIBLE: 'dietary preference is incompatible',
  CAPACITY_EXHAUSTED: 'no remaining collection capacity today',
  REFRIGERATION_REQUIRED: 'this food needs refrigeration the NGO does not have',
  PICKUP_DEADLINE_NOT_FEASIBLE: 'cannot realistically collect before the pickup deadline',
  ALREADY_REQUESTED: 'already has a request for this donation',
  DONOR_PAUSED: 'donor has paused availability',
  NOT_ACCEPTING_REQUESTS: 'donor is not accepting assistance requests',
  CATEGORY_NOT_PRODUCED: 'donor does not produce this food category',
  CLOSED_DURING_WINDOW: 'donor is closed during the required time window',
  ALREADY_OFFERED: 'donor already made an offer',
};

interface Evaluated {
  id: string;
  name: string;
  ownerUserId: string;
  distanceM: number;
  prefMaxDistanceKm: number | null;
  reasons: string[];
  payload: Record<string, unknown>;
}

export interface MatchRun {
  runId: string;
  rankingStatus: 'RANKED' | 'RANKING_UNAVAILABLE' | 'NO_ELIGIBLE_CANDIDATES';
  evaluated: number;
  eligible: number;
  notified: number;
}

const URGENCY_ORDER = `CASE f.urgency WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`;

function mealPeriodFor(minutes: number): 'BREAKFAST' | 'LUNCH' | 'DINNER' {
  if (minutes < 11 * 60) return 'BREAKFAST';
  if (minutes < 16 * 60) return 'LUNCH';
  return 'DINNER';
}

/**
 * Two-way matching. Hard eligibility filters run here (business rules tied to
 * authorisation and PostGIS); the AI service scores and explains eligible
 * candidates with a deterministic weighted model. If the AI service is
 * unavailable, eligible candidates are ordered by distance and labelled.
 */
export class MatchingService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiClient,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // Donation → NGOs
  // -------------------------------------------------------------------------
  async matchDonation(donationId: string, opts: { notify?: boolean } = {}): Promise<MatchRun | null> {
    const d = await findDonation(this.db, donationId);
    if (!d || !['AVAILABLE', 'PARTIALLY_RESERVED'].includes(d.status) || d.origin !== 'DIRECT_LISTING') return null;
    const [maxRadiusKm, minLead, weights, maxNotified] = await Promise.all([
      this.settings.get('matching.max_radius_km'),
      this.settings.get('matching.min_lead_minutes'),
      this.settings.get('matching.weights'),
      this.settings.get('matching.max_notified'),
    ]);
    const rows = await many<{
      ngo_id: string;
      name: string;
      owner_user_id: string;
      distance_m: number;
      collection_radius_km: number;
      accepts_veg: boolean;
      accepts_non_veg: boolean;
      max_daily_capacity: number;
      has_refrigeration: boolean;
      beneficiaries_count: number;
      accepts_category: boolean;
      reserved_today: number;
      already_requested: boolean;
      open_need: { quantity_remaining: number; urgency: string; dietary_requirement: string } | null;
      completed: number;
      failed: number;
      pref_max_distance_km: number | null;
    }>(
      this.db,
      `WITH d AS (SELECT id, location, category_id, dietary_type, unit, pickup_deadline FROM donations WHERE id = $1)
       SELECT n.id AS ngo_id, n.organization_name AS name, n.owner_user_id, ST_Distance(n.location, d.location) AS distance_m,
              n.collection_radius_km, n.accepts_veg, n.accepts_non_veg, n.max_daily_capacity, n.has_refrigeration, n.beneficiaries_count,
              EXISTS (SELECT 1 FROM ngo_food_preferences p WHERE p.ngo_id = n.id AND p.category_id = d.category_id) AS accepts_category,
              COALESCE((SELECT sum(a.quantity) FROM donation_allocations a JOIN donations d2 ON d2.id = a.donation_id
                         WHERE a.ngo_id = n.id AND a.status IN ('RESERVED','PICKUP_ASSIGNED','PICKED_UP','IN_TRANSIT')
                           AND d2.unit = d.unit AND (d2.pickup_deadline AT TIME ZONE n.timezone)::date = (d.pickup_deadline AT TIME ZONE n.timezone)::date), 0) AS reserved_today,
              EXISTS (SELECT 1 FROM donation_requests r WHERE r.donation_id = d.id AND r.ngo_id = n.id AND r.status IN ('PENDING','APPROVED')) AS already_requested,
              (SELECT json_build_object('quantity_remaining', f.quantity_required - f.quantity_committed, 'urgency', f.urgency, 'dietary_requirement', f.dietary_requirement)
                 FROM food_assistance_requests f
                WHERE f.ngo_id = n.id AND f.status IN ('OPEN','PARTIALLY_FULFILLED') AND f.deleted_at IS NULL AND f.needed_until > now()
                  AND f.category_id = d.category_id AND f.unit = d.unit AND (f.dietary_requirement = 'ANY' OR d.dietary_type = 'VEG')
                ORDER BY ${URGENCY_ORDER} DESC, f.needed_from LIMIT 1) AS open_need,
              (SELECT count(*) FROM donation_allocations a WHERE a.ngo_id = n.id AND a.status = 'COMPLETED') AS completed,
              (SELECT count(*) FROM donation_allocations a WHERE a.ngo_id = n.id
                  AND (a.status = 'EXPIRED' OR (a.status = 'CANCELLED' AND a.cancelled_by_party = 'NGO'))) AS failed,
              np.max_distance_km AS pref_max_distance_km
         FROM d JOIN ngos n ON ST_DWithin(n.location, d.location, $2)
         JOIN users u ON u.id = n.owner_user_id
         LEFT JOIN notification_preferences np ON np.user_id = n.owner_user_id
        WHERE n.verification_status = 'APPROVED' AND n.deleted_at IS NULL AND u.account_status = 'ACTIVE' AND u.deleted_at IS NULL
        ORDER BY distance_m LIMIT 500`,
      [donationId, maxRadiusKm * 1000],
    );

    const available = d.quantity - d.reserved_quantity;
    const minutesUntilDeadline = Math.floor((d.pickup_deadline.getTime() - Date.now()) / 60_000);
    const evaluated: Evaluated[] = rows.map((r) => {
      const reasons: string[] = [];
      if (r.distance_m > r.collection_radius_km * 1000) reasons.push('OUTSIDE_COLLECTION_RADIUS');
      if (!r.accepts_category) reasons.push('CATEGORY_NOT_ACCEPTED');
      if (d.dietary_type === 'VEG' ? !r.accepts_veg : !r.accepts_non_veg) reasons.push('DIETARY_INCOMPATIBLE');
      const capacityRemaining = r.max_daily_capacity - r.reserved_today;
      if (capacityRemaining <= 0) reasons.push('CAPACITY_EXHAUSTED');
      if (d.category_requires_refrigeration && !r.has_refrigeration) reasons.push('REFRIGERATION_REQUIRED');
      if (minutesUntilDeadline - r.distance_m / ESTIMATED_SPEED_M_PER_MIN < minLead) reasons.push('PICKUP_DEADLINE_NOT_FEASIBLE');
      if (r.already_requested) reasons.push('ALREADY_REQUESTED');
      return {
        id: r.ngo_id,
        name: r.name,
        ownerUserId: r.owner_user_id,
        distanceM: r.distance_m,
        prefMaxDistanceKm: r.pref_max_distance_km,
        reasons,
        payload: {
          ngo_id: r.ngo_id,
          name: r.name,
          distance_m: Math.round(r.distance_m),
          distance_source: 'STRAIGHT_LINE_ESTIMATE',
          travel_time_s: null,
          collection_radius_m: r.collection_radius_km * 1000,
          capacity_remaining: Math.max(0, capacityRemaining),
          open_need: r.open_need,
          has_refrigeration: r.has_refrigeration,
          accepts_veg: r.accepts_veg,
          accepts_non_veg: r.accepts_non_veg,
          reliability: { completed: r.completed, failed: r.failed },
          beneficiaries_count: r.beneficiaries_count,
        },
      };
    });

    const body = {
      donation: {
        id: d.id,
        category_code: d.category_code,
        dietary_type: d.dietary_type,
        quantity_available: available,
        unit: d.unit,
        storage_type: d.storage_type,
        requires_refrigeration: d.category_requires_refrigeration,
        minutes_until_deadline: Math.max(0, minutesUntilDeadline),
      },
      weights,
    };
    const run = await this.rankAndStore('DONATION', donationId, evaluated, (candidates) => this.ai.matchNgos({ ...body, candidates }), weights);

    let notified = 0;
    if (opts.notify !== false && run.ranked.length > 0) {
      const notices: (NotificationRow | null)[] = [];
      await this.db.transaction(async (tx) => {
        for (const c of run.ranked.slice(0, maxNotified)) {
          if (c.prefMaxDistanceKm !== null && c.distanceM > c.prefMaxDistanceKm * 1000) continue;
          const n = await this.notifications.create(tx, {
            userId: c.ownerUserId,
            type: 'DONATION_MATCH',
            title: `${available} ${unitLabel(d.unit, available)} available nearby`,
            body: `${d.donor_name} listed ${available} ${d.dietary_type === 'VEG' ? 'vegetarian' : 'non-vegetarian'} ${unitLabel(d.unit, available)} of ${d.food_name} (${d.category_name}) ${formatKm(c.distanceM)} away (straight-line). Pickup by ${formatDateTime(d.pickup_deadline)}.`,
            linkPath: `/ngo/marketplace/${d.id}`,
            dedupeKey: `donation-match:${d.id}`,
            data: { donationId: d.id, score: c.score, rank: c.rank },
            respectFrequencyLimit: true,
            email: true,
          });
          if (n) {
            notified += 1;
            notices.push(n);
            await tx.query('UPDATE match_recommendations SET notified_at = now(), notification_id = $3 WHERE run_id = $1 AND candidate_ngo_id = $2', [run.runId, c.id, n.id]);
          }
        }
      });
      this.notifications.publish(notices);
    }
    return { runId: run.runId, rankingStatus: run.status, evaluated: evaluated.length, eligible: run.ranked.length, notified };
  }

  // -------------------------------------------------------------------------
  // Assistance request → donors
  // -------------------------------------------------------------------------
  async matchAssistanceRequest(requestId: string, opts: { notify?: boolean } = {}): Promise<MatchRun | null> {
    const f = await one<{
      id: string;
      ngo_name: string;
      category_code: string;
      category_name: string;
      dietary_requirement: 'VEG_ONLY' | 'ANY';
      quantity_required: number;
      quantity_committed: number;
      unit: string;
      urgency: string;
      beneficiaries_count: number;
      needed_from: Date;
      needed_until: Date;
      status: string;
      collection_radius_km: number;
    }>(
      this.db,
      `SELECT f.id, n.organization_name AS ngo_name, c.code AS category_code, c.name AS category_name, f.dietary_requirement, f.quantity_required,
              f.quantity_committed, f.unit, f.urgency, f.beneficiaries_count, f.needed_from, f.needed_until, f.status, n.collection_radius_km
         FROM food_assistance_requests f JOIN ngos n ON n.id = f.ngo_id JOIN food_categories c ON c.id = f.category_id
        WHERE f.id = $1 AND f.deleted_at IS NULL`,
      [requestId],
    );
    if (!f || !['OPEN', 'PARTIALLY_FULFILLED'].includes(f.status) || f.needed_until <= new Date()) return null;
    const [maxRadiusKm, weights, maxNotified] = await Promise.all([
      this.settings.get('matching.max_radius_km'),
      this.settings.get('matching.weights'),
      this.settings.get('matching.max_notified'),
    ]);
    const tz = 'Asia/Kolkata';
    const neededLocal = localClock(f.needed_from, tz);
    const windowMinutes = Math.max(1, Math.round((f.needed_until.getTime() - f.needed_from.getTime()) / 60_000));
    const mealPeriod = mealPeriodFor(neededLocal.minutes);
    const rows = await many<{
      donor_id: string;
      name: string;
      owner_user_id: string;
      distance_m: number;
      paused: boolean;
      accepts_assistance_requests: boolean;
      produces_category: boolean;
      available_matching_quantity: number;
      historical_avg_surplus: number | null;
      predicted_surplus: number | null;
      already_offered: boolean;
      completed: number;
      failed: number;
      pref_max_distance_km: number | null;
    }>(
      this.db,
      `WITH f AS (SELECT id, location, category_id, dietary_requirement, unit, needed_from FROM food_assistance_requests WHERE id = $1)
       SELECT dn.id AS donor_id, dn.business_name AS name, dn.owner_user_id, ST_Distance(dn.location, f.location) AS distance_m,
              (dn.paused_until IS NOT NULL AND dn.paused_until > now()) AS paused, dn.accepts_assistance_requests,
              EXISTS (SELECT 1 FROM donor_food_categories x WHERE x.donor_id = dn.id AND x.category_id = f.category_id) AS produces_category,
              COALESCE((SELECT sum(d.quantity - d.reserved_quantity) FROM donations d
                         WHERE d.donor_id = dn.id AND d.origin = 'DIRECT_LISTING' AND d.status IN ('AVAILABLE','PARTIALLY_RESERVED')
                           AND d.deleted_at IS NULL AND d.category_id = f.category_id AND d.unit = f.unit AND d.pickup_deadline > now()
                           AND (f.dietary_requirement = 'ANY' OR d.dietary_type = 'VEG')), 0) AS available_matching_quantity,
              (SELECT avg(m.surplus_qty) FROM restaurant_daily_metrics m
                WHERE m.donor_id = dn.id AND m.unit = f.unit AND m.meal_period IN ($3, 'ALL_DAY')
                  AND m.metric_date >= (f.needed_from AT TIME ZONE dn.timezone)::date - 56
                  AND EXTRACT(ISODOW FROM m.metric_date) = EXTRACT(ISODOW FROM (f.needed_from AT TIME ZONE dn.timezone)::date)) AS historical_avg_surplus,
              (SELECT p.predicted_quantity FROM surplus_predictions p
                WHERE p.donor_id = dn.id AND p.status = 'OK' AND p.meal_period IN ($3, 'ALL_DAY')
                  AND p.target_date = (f.needed_from AT TIME ZONE dn.timezone)::date ORDER BY p.created_at DESC LIMIT 1) AS predicted_surplus,
              EXISTS (SELECT 1 FROM assistance_offers o WHERE o.assistance_request_id = f.id AND o.donor_id = dn.id
                        AND o.status IN ('PROPOSED','ACCEPTED','RESERVED','PICKUP_ASSIGNED')) AS already_offered,
              (SELECT count(*) FROM donation_allocations a JOIN donations d ON d.id = a.donation_id WHERE d.donor_id = dn.id AND a.status = 'COMPLETED') AS completed,
              (SELECT count(*) FROM donation_allocations a JOIN donations d ON d.id = a.donation_id
                WHERE d.donor_id = dn.id AND a.status = 'CANCELLED' AND a.cancelled_by_party = 'DONOR') AS failed,
              np.max_distance_km AS pref_max_distance_km
         FROM f JOIN donors dn ON ST_DWithin(dn.location, f.location, $2)
         JOIN users u ON u.id = dn.owner_user_id
         LEFT JOIN notification_preferences np ON np.user_id = dn.owner_user_id
        WHERE dn.verification_status = 'APPROVED' AND dn.deleted_at IS NULL AND u.account_status = 'ACTIVE' AND u.deleted_at IS NULL
        ORDER BY distance_m LIMIT 500`,
      [requestId, maxRadiusKm * 1000, mealPeriod],
    );
    const availability = await this.availabilityOverlap(
      rows.map((r) => r.donor_id),
      neededLocal,
      windowMinutes,
    );
    const radiusM = f.collection_radius_km * 1000;
    const remaining = f.quantity_required - f.quantity_committed;
    const evaluated: Evaluated[] = rows.map((r) => {
      const reasons: string[] = [];
      if (r.distance_m > radiusM) reasons.push('OUTSIDE_COLLECTION_RADIUS');
      if (r.paused) reasons.push('DONOR_PAUSED');
      if (!r.accepts_assistance_requests) reasons.push('NOT_ACCEPTING_REQUESTS');
      if (!r.produces_category && r.available_matching_quantity <= 0) reasons.push('CATEGORY_NOT_PRODUCED');
      const overlap = availability.get(r.donor_id) ?? null;
      if (overlap === 0 && r.available_matching_quantity <= 0) reasons.push('CLOSED_DURING_WINDOW');
      if (r.already_offered) reasons.push('ALREADY_OFFERED');
      return {
        id: r.donor_id,
        name: r.name,
        ownerUserId: r.owner_user_id,
        distanceM: r.distance_m,
        prefMaxDistanceKm: r.pref_max_distance_km,
        reasons,
        payload: {
          donor_id: r.donor_id,
          name: r.name,
          distance_m: Math.round(r.distance_m),
          distance_source: 'STRAIGHT_LINE_ESTIMATE',
          travel_time_s: null,
          max_radius_m: radiusM,
          available_matching_quantity: r.available_matching_quantity,
          predicted_surplus: r.predicted_surplus,
          historical_avg_surplus: r.historical_avg_surplus === null ? null : Math.round(r.historical_avg_surplus * 10) / 10,
          produces_category: r.produces_category,
          availability_overlap_minutes: overlap,
          needed_window_minutes: windowMinutes,
          reliability: { completed: r.completed, failed: r.failed },
        },
      };
    });
    const body = {
      request: {
        id: f.id,
        category_code: f.category_code,
        dietary_requirement: f.dietary_requirement,
        quantity_remaining: Math.max(1, remaining),
        unit: f.unit,
        urgency: f.urgency,
        beneficiaries_count: f.beneficiaries_count,
        needed_from: f.needed_from.toISOString(),
        needed_until: f.needed_until.toISOString(),
      },
      weights,
    };
    const run = await this.rankAndStore('ASSISTANCE_REQUEST', requestId, evaluated, (candidates) => this.ai.matchDonors({ ...body, candidates }), weights);

    let notified = 0;
    if (opts.notify !== false && run.ranked.length > 0) {
      const notices: (NotificationRow | null)[] = [];
      const diet = f.dietary_requirement === 'VEG_ONLY' ? 'vegetarian ' : '';
      await this.db.transaction(async (tx) => {
        for (const c of run.ranked.slice(0, maxNotified)) {
          if (c.prefMaxDistanceKm !== null && c.distanceM > c.prefMaxDistanceKm * 1000) continue;
          const n = await this.notifications.create(tx, {
            userId: c.ownerUserId,
            type: 'ASSISTANCE_MATCH',
            title: `${f.ngo_name} needs ${remaining} ${diet}${unitLabel(f.unit, remaining)}`,
            body: `${f.ngo_name} needs ${remaining} ${diet}${unitLabel(f.unit, remaining)} (${f.category_name.toLowerCase()}) on ${formatDateTime(f.needed_from)}–${formatTime(f.needed_until)}. Your organisation may be able to contribute based on its available quantity and historical surplus. Forecasts are estimates — only food you confirm becomes an offer.`,
            linkPath: `/donor/assistance/${f.id}`,
            dedupeKey: `assistance-match:${f.id}`,
            data: { assistanceRequestId: f.id, score: c.score, rank: c.rank },
            respectFrequencyLimit: true,
            email: true,
          });
          if (n) {
            notified += 1;
            notices.push(n);
            await tx.query('UPDATE match_recommendations SET notified_at = now(), notification_id = $3 WHERE run_id = $1 AND candidate_donor_id = $2', [run.runId, c.id, n.id]);
          }
        }
      });
      this.notifications.publish(notices);
    }
    return { runId: run.runId, rankingStatus: run.status, evaluated: evaluated.length, eligible: run.ranked.length, notified };
  }

  /** Minutes of overlap between the needed window and each donor's configured opening hours (null = not configured). */
  private async availabilityOverlap(donorIds: string[], needed: { minutes: number; isoWeekday: number }, windowMinutes: number): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    if (donorIds.length === 0) return result;
    const slots = await many<{ donor_id: string; iso_day_of_week: number; opens: number; closes: number }>(
      this.db,
      `SELECT donor_id, iso_day_of_week, EXTRACT(EPOCH FROM opens_at)::int / 60 AS opens, EXTRACT(EPOCH FROM closes_at)::int / 60 AS closes
         FROM donor_availability WHERE donor_id = ANY($1::uuid[])`,
      [donorIds],
    );
    const start = needed.minutes;
    const end = Math.min(24 * 60, start + windowMinutes);
    for (const id of donorIds) {
      const own = slots.filter((s) => s.donor_id === id);
      if (own.length === 0) {
        result.set(id, null);
        continue;
      }
      const overlap = own
        .filter((s) => s.iso_day_of_week === needed.isoWeekday)
        .reduce((sum, s) => sum + Math.max(0, Math.min(end, s.closes) - Math.max(start, s.opens)), 0);
      result.set(id, overlap);
    }
    return result;
  }

  /** Scores eligible candidates via the AI service (or falls back), stores every evaluation, returns ranked eligible ones. */
  private async rankAndStore(
    subject: 'DONATION' | 'ASSISTANCE_REQUEST',
    subjectId: string,
    evaluated: Evaluated[],
    score: (candidates: Record<string, unknown>[]) => Promise<MatchResponse>,
    weights: Record<string, number>,
  ) {
    const runId = randomUUID();
    const eligible = evaluated.filter((e) => e.reasons.length === 0);
    let status: MatchRun['rankingStatus'] = eligible.length === 0 ? 'NO_ELIGIBLE_CANDIDATES' : 'RANKED';
    let ranked: (Evaluated & { score: number | null; rank: number; result?: RankedResult })[] = [];
    if (eligible.length > 0) {
      try {
        const response = await score(eligible.map((e) => e.payload));
        const byId = new Map(eligible.map((e) => [e.id, e]));
        ranked = response.results
          .filter((r) => byId.has(r.candidate_id))
          .map((r) => ({ ...(byId.get(r.candidate_id) as Evaluated), score: r.score, rank: r.rank, result: r }));
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) this.logger.error({ err }, 'AI matching failed; using fallback');
        status = 'RANKING_UNAVAILABLE';
        ranked = [...eligible].sort((a, b) => a.distanceM - b.distanceM).map((e, i) => ({ ...e, score: null, rank: i + 1 }));
      }
    }
    const column = subject === 'DONATION' ? 'donation_id' : 'assistance_request_id';
    const candidateColumn = subject === 'DONATION' ? 'candidate_ngo_id' : 'candidate_donor_id';
    await this.db.transaction(async (tx) => {
      for (const c of ranked) {
        const fallback = !c.result;
        await this.insertRecommendation(tx, {
          runId,
          subject,
          column,
          subjectId,
          candidateColumn,
          candidateId: c.id,
          eligible: true,
          reasons: [],
          score: c.score,
          rank: c.rank,
          rankingStatus: fallback ? 'RANKING_UNAVAILABLE' : 'RANKED',
          criteria: c.result?.criteria ?? null,
          explanation: c.result?.explanation ?? `${c.name} meets every eligibility rule and is ${formatKm(c.distanceM)} away (straight-line estimate).`,
          limitations: c.result?.limitations ?? [FALLBACK_LIMITATION, 'Distance is a straight-line estimate, not road distance.'],
          distanceM: c.distanceM,
          weights,
        });
      }
      for (const c of evaluated.filter((e) => e.reasons.length > 0)) {
        await this.insertRecommendation(tx, {
          runId,
          subject,
          column,
          subjectId,
          candidateColumn,
          candidateId: c.id,
          eligible: false,
          reasons: c.reasons,
          score: null,
          rank: null,
          rankingStatus: 'NOT_RANKED',
          criteria: null,
          explanation: `Not eligible: ${c.reasons.map((r) => INELIGIBILITY_TEXT[r] ?? r).join('; ')}.`,
          limitations: [],
          distanceM: c.distanceM,
          weights,
        });
      }
    });
    return { runId, status, ranked };
  }

  private async insertRecommendation(
    tx: Queryable,
    r: {
      runId: string;
      subject: string;
      column: string;
      subjectId: string;
      candidateColumn: string;
      candidateId: string;
      eligible: boolean;
      reasons: string[];
      score: number | null;
      rank: number | null;
      rankingStatus: string;
      criteria: unknown;
      explanation: string;
      limitations: string[];
      distanceM: number;
      weights: Record<string, number>;
    },
  ) {
    await tx.query(
      `INSERT INTO match_recommendations (run_id, subject_type, ${r.column}, ${r.candidateColumn}, eligible, ineligibility_reasons, score, rank,
                                          ranking_status, criteria, explanation, limitations, distance_m, distance_source, algorithm_version, weights)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'STRAIGHT_LINE_ESTIMATE', $14, $15)`,
      [
        r.runId,
        r.subject,
        r.subjectId,
        r.candidateId,
        r.eligible,
        r.reasons,
        r.score,
        r.rank,
        r.rankingStatus,
        r.criteria ? JSON.stringify(r.criteria) : null,
        r.explanation,
        r.limitations,
        Math.round(r.distanceM * 100) / 100,
        ALGORITHM_VERSION,
        JSON.stringify(r.weights),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Read models
  // -------------------------------------------------------------------------
  private async latestRun(column: 'donation_id' | 'assistance_request_id', id: string): Promise<string | undefined> {
    return (await one<{ run_id: string }>(this.db, `SELECT run_id FROM match_recommendations WHERE ${column} = $1 ORDER BY created_at DESC LIMIT 1`, [id]))?.run_id;
  }

  private mapRecommendation(r: Record<string, unknown>) {
    return {
      candidate: { id: r.candidate_id, name: r.candidate_name, type: r.candidate_type },
      eligible: r.eligible,
      ineligibilityReasons: (r.ineligibility_reasons as string[]).map((code) => ({ code, text: INELIGIBILITY_TEXT[code] ?? code })),
      score: r.score,
      rank: r.rank,
      rankingStatus: r.ranking_status,
      criteria: r.criteria,
      explanation: r.explanation,
      limitations: r.limitations,
      distanceKm: r.distance_m === null ? null : Math.round((r.distance_m as number) / 100) / 10,
      distanceSource: r.distance_source,
      algorithmVersion: r.algorithm_version,
      notifiedAt: r.notified_at,
      response: r.response,
      createdAt: r.created_at,
    };
  }

  /** Ranked NGO recommendations for a donor's donation (with eligibility explanations). */
  async recommendationsForDonation(auth: AuthContext, donationId: string) {
    const d = await findDonation(this.db, donationId);
    if (!d || (auth.role !== 'ADMIN' && d.donor_id !== auth.donorId)) throw notFound('Donation');
    const runId = await this.latestRun('donation_id', donationId);
    if (!runId) return { runId: null, rankingStatus: 'NOT_RUN', items: [] };
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT m.*, n.id AS candidate_id, n.organization_name AS candidate_name, 'NGO' AS candidate_type
         FROM match_recommendations m JOIN ngos n ON n.id = m.candidate_ngo_id
        WHERE m.run_id = $1 ORDER BY m.eligible DESC, m.rank NULLS LAST, m.distance_m`,
      [runId],
    );
    const status = rows.some((r) => r.ranking_status === 'RANKING_UNAVAILABLE') ? 'RANKING_UNAVAILABLE' : rows.some((r) => r.eligible) ? 'RANKED' : 'NO_ELIGIBLE_CANDIDATES';
    return { runId, rankingStatus: status, items: rows.map((r) => this.mapRecommendation(r)) };
  }

  /** Ranked donor recommendations for an NGO's assistance request. */
  async recommendationsForRequest(auth: AuthContext, requestId: string) {
    const f = await one<{ ngo_id: string }>(this.db, 'SELECT ngo_id FROM food_assistance_requests WHERE id = $1', [requestId]);
    if (!f || (auth.role !== 'ADMIN' && f.ngo_id !== auth.ngoId)) throw notFound('Assistance request');
    const runId = await this.latestRun('assistance_request_id', requestId);
    if (!runId) return { runId: null, rankingStatus: 'NOT_RUN', items: [] };
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT m.*, d.id AS candidate_id, d.business_name AS candidate_name, 'DONOR' AS candidate_type
         FROM match_recommendations m JOIN donors d ON d.id = m.candidate_donor_id
        WHERE m.run_id = $1 ORDER BY m.eligible DESC, m.rank NULLS LAST, m.distance_m`,
      [runId],
    );
    const status = rows.some((r) => r.ranking_status === 'RANKING_UNAVAILABLE') ? 'RANKING_UNAVAILABLE' : rows.some((r) => r.eligible) ? 'RANKED' : 'NO_ELIGIBLE_CANDIDATES';
    return { runId, rankingStatus: status, items: rows.map((r) => this.mapRecommendation(r)) };
  }

  /** Open donations recommended to the NGO (latest run per donation, eligible only, best score first). */
  async recommendedDonationsForNgo(auth: AuthContext) {
    const ngoId = scopedNgoId(auth);
    if (!ngoId) throw forbidden();
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT * FROM (
         SELECT DISTINCT ON (m.donation_id) m.donation_id, m.score, m.rank, m.ranking_status, m.explanation, m.limitations, m.criteria,
                m.distance_m, m.created_at, d.food_name, d.quantity - d.reserved_quantity AS available, d.unit, d.dietary_type,
                d.pickup_deadline, dn.business_name AS donor_name, c.name AS category_name, m.eligible, m.run_id
           FROM match_recommendations m
           JOIN donations d ON d.id = m.donation_id JOIN donors dn ON dn.id = d.donor_id JOIN food_categories c ON c.id = d.category_id
          WHERE m.candidate_ngo_id = $1 AND d.status IN ('AVAILABLE','PARTIALLY_RESERVED') AND d.pickup_deadline > now()
          ORDER BY m.donation_id, m.created_at DESC) x
        WHERE x.eligible
        ORDER BY x.score DESC NULLS LAST, x.distance_m LIMIT 50`,
      [ngoId],
    );
    return rows.map((r) => ({
      donation: {
        id: r.donation_id,
        foodName: r.food_name,
        availableQuantity: r.available,
        unit: r.unit,
        dietaryType: r.dietary_type,
        pickupDeadline: r.pickup_deadline,
        donorName: r.donor_name,
        categoryName: r.category_name,
      },
      score: r.score,
      rankingStatus: r.ranking_status,
      explanation: r.explanation,
      limitations: r.limitations,
      criteria: r.criteria,
      distanceKm: Math.round((r.distance_m as number) / 100) / 10,
      distanceSource: 'STRAIGHT_LINE_ESTIMATE',
    }));
  }

  /** Open assistance requests recommended to the donor. */
  async recommendedRequestsForDonor(auth: AuthContext) {
    if (!auth.donorId) throw forbidden();
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT * FROM (
         SELECT DISTINCT ON (m.assistance_request_id) m.assistance_request_id, m.score, m.ranking_status, m.explanation, m.limitations, m.criteria,
                m.distance_m, m.response, f.quantity_required - f.quantity_committed AS remaining, f.unit, f.dietary_requirement, f.urgency,
                f.needed_from, f.needed_until, n.organization_name AS ngo_name, c.name AS category_name, m.eligible
           FROM match_recommendations m
           JOIN food_assistance_requests f ON f.id = m.assistance_request_id JOIN ngos n ON n.id = f.ngo_id JOIN food_categories c ON c.id = f.category_id
          WHERE m.candidate_donor_id = $1 AND f.status IN ('OPEN','PARTIALLY_FULFILLED') AND f.needed_until > now()
          ORDER BY m.assistance_request_id, m.created_at DESC) x
        WHERE x.eligible
        ORDER BY x.score DESC NULLS LAST, x.distance_m LIMIT 50`,
      [auth.donorId],
    );
    return rows.map((r) => ({
      request: {
        id: r.assistance_request_id,
        ngoName: r.ngo_name,
        categoryName: r.category_name,
        quantityRemaining: r.remaining,
        unit: r.unit,
        dietaryRequirement: r.dietary_requirement,
        urgency: r.urgency,
        neededFrom: r.needed_from,
        neededUntil: r.needed_until,
      },
      score: r.score,
      rankingStatus: r.ranking_status,
      explanation: r.explanation,
      limitations: r.limitations,
      criteria: r.criteria,
      response: r.response,
      distanceKm: Math.round((r.distance_m as number) / 100) / 10,
      distanceSource: 'STRAIGHT_LINE_ESTIMATE',
    }));
  }

  /** Owner-triggered re-run (no new notifications are sent twice thanks to dedupe keys). */
  async refreshDonation(auth: AuthContext, donationId: string) {
    const d = await findDonation(this.db, donationId);
    if (!d || (auth.role !== 'ADMIN' && d.donor_id !== auth.donorId)) throw notFound('Donation');
    await this.matchDonation(donationId);
    return this.recommendationsForDonation(auth, donationId);
  }

  async refreshRequest(auth: AuthContext, requestId: string) {
    const f = await one<{ ngo_id: string }>(this.db, 'SELECT ngo_id FROM food_assistance_requests WHERE id = $1', [requestId]);
    if (!f || (auth.role !== 'ADMIN' && f.ngo_id !== auth.ngoId)) throw notFound('Assistance request');
    await this.matchAssistanceRequest(requestId);
    return this.recommendationsForRequest(auth, requestId);
  }

  // -------------------------------------------------------------------------
  // Allocation optimisation (recommendation only; execution is transactional elsewhere)
  // -------------------------------------------------------------------------

  /** Proposes how to split a donation across its pending NGO requests. */
  async proposeDonationAllocation(auth: AuthContext, donationId: string) {
    const d = await findDonation(this.db, donationId);
    if (!d || d.donor_id !== auth.donorId) throw notFound('Donation');
    const available = d.quantity - d.reserved_quantity;
    const requests = await many<{ id: string; ngo_id: string; ngo_name: string; requested_quantity: number; created_at: Date; score: number | null }>(
      this.db,
      `SELECT r.id, r.ngo_id, n.organization_name AS ngo_name, r.requested_quantity, r.created_at,
              (SELECT m.score FROM match_recommendations m WHERE m.donation_id = r.donation_id AND m.candidate_ngo_id = r.ngo_id ORDER BY m.created_at DESC LIMIT 1) AS score
         FROM donation_requests r JOIN ngos n ON n.id = r.ngo_id WHERE r.donation_id = $1 AND r.status = 'PENDING' ORDER BY r.created_at`,
      [donationId],
    );
    if (requests.length === 0 || available <= 0) {
      return { source: 'NONE', status: 'NO_FEASIBLE_ALLOCATION', allocations: [], explanation: available <= 0 ? 'Nothing is left to allocate.' : 'There are no pending requests to allocate.', reasons: [] };
    }
    const named = new Map(requests.map((r) => [r.id, r]));
    try {
      const res = await this.ai.allocateFood({
        supplies: [{ id: donationId, quantity: available }],
        demands: requests.map((r) => ({ id: r.id, quantity: r.requested_quantity, min_quantity: 1 })),
        edges: requests.map((r) => ({ supply_id: donationId, demand_id: r.id, score: r.score ?? 50, max_quantity: null })),
        time_limit_s: 5,
      });
      return {
        source: 'AI_OPTIMIZER',
        status: res.status,
        allocations: res.allocations.map((a) => ({ requestId: a.demand_id, ngoName: named.get(a.demand_id)?.ngo_name, quantity: a.quantity, requested: named.get(a.demand_id)?.requested_quantity })),
        totalAllocated: res.total_allocated,
        explanation: res.explanation,
        reasons: res.reasons,
      };
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      // Deterministic fallback: first come, first served.
      let left = available;
      const allocations = requests.map((r) => {
        const quantity = Math.min(left, r.requested_quantity);
        left -= quantity;
        return { requestId: r.id, ngoName: r.ngo_name, quantity, requested: r.requested_quantity };
      }).filter((a) => a.quantity > 0);
      return {
        source: 'FALLBACK_FIRST_COME',
        status: 'FEASIBLE',
        allocations,
        totalAllocated: available - left,
        explanation: 'The allocation optimiser is unavailable, so requests are filled in the order they arrived. Review before approving.',
        reasons: ['AI optimiser unavailable'],
      };
    }
  }

  /** Proposes which offers to accept (and how much) to cover an assistance request. */
  async proposeRequestAllocation(auth: AuthContext, requestId: string) {
    const f = await one<{ ngo_id: string; quantity_required: number; quantity_committed: number }>(
      this.db,
      'SELECT ngo_id, quantity_required, quantity_committed FROM food_assistance_requests WHERE id = $1',
      [requestId],
    );
    if (!f || f.ngo_id !== auth.ngoId) throw notFound('Assistance request');
    const remaining = f.quantity_required - f.quantity_committed;
    const offers = await many<{ id: string; donor_id: string; donor_name: string; offered_quantity: number; score: number | null }>(
      this.db,
      `SELECT o.id, o.donor_id, dn.business_name AS donor_name, o.offered_quantity,
              (SELECT m.score FROM match_recommendations m WHERE m.assistance_request_id = o.assistance_request_id AND m.candidate_donor_id = o.donor_id ORDER BY m.created_at DESC LIMIT 1) AS score
         FROM assistance_offers o JOIN donors dn ON dn.id = o.donor_id WHERE o.assistance_request_id = $1 AND o.status = 'PROPOSED' ORDER BY o.created_at`,
      [requestId],
    );
    if (offers.length === 0 || remaining <= 0) {
      return { source: 'NONE', status: 'NO_FEASIBLE_ALLOCATION', allocations: [], explanation: remaining <= 0 ? 'The request is already fully covered.' : 'There are no proposed offers yet.', reasons: [] };
    }
    const named = new Map(offers.map((o) => [o.id, o]));
    try {
      const res = await this.ai.allocateFood({
        supplies: offers.map((o) => ({ id: o.id, quantity: o.offered_quantity })),
        demands: [{ id: requestId, quantity: remaining, min_quantity: 1 }],
        edges: offers.map((o) => ({ supply_id: o.id, demand_id: requestId, score: o.score ?? 50, max_quantity: null })),
        time_limit_s: 5,
      });
      return {
        source: 'AI_OPTIMIZER',
        status: res.status,
        allocations: res.allocations.map((a) => ({ offerId: a.supply_id, donorName: named.get(a.supply_id)?.donor_name, quantity: a.quantity, offered: named.get(a.supply_id)?.offered_quantity })),
        totalAllocated: res.total_allocated,
        explanation: res.explanation,
        reasons: res.reasons,
      };
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      let left = remaining;
      const allocations = offers.map((o) => {
        const quantity = Math.min(left, o.offered_quantity);
        left -= quantity;
        return { offerId: o.id, donorName: o.donor_name, quantity, offered: o.offered_quantity };
      }).filter((a) => a.quantity > 0);
      return {
        source: 'FALLBACK_FIRST_COME',
        status: 'FEASIBLE',
        allocations,
        totalAllocated: remaining - left,
        explanation: 'The allocation optimiser is unavailable, so offers are taken in the order they arrived. Review before accepting.',
        reasons: ['AI optimiser unavailable'],
      };
    }
  }
}
