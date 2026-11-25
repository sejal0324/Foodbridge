import type { Logger } from '../config/logger.js';
import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import { AiUnavailableError, type AiClient } from '../integrations/ai-client.js';
import { type AuthContext, scopedNgoId } from '../types/auth.js';
import { forbidden } from '../utils/errors.js';
import { SERVICE_FEE_REVENUE_SQL } from './billing.service.js';
import type { SettingsService } from './settings.service.js';

const MONTHS = 12;

/** Aggregations from real stored records only. Demo seed data is labelled so it is never mistaken for platform statistics. */
export class AnalyticsService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiClient,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  /** REAL unless the development demo seed has been loaded into this database. */
  async dataLabel(): Promise<'REAL' | 'MIXED'> {
    const row = await one<{ value: { seeded?: boolean } }>(this.db, `SELECT value FROM platform_settings WHERE key = 'platform.demo_data'`);
    return row?.value?.seeded ? 'MIXED' : 'REAL';
  }

  /** Public, aggregate-only impact figures for the landing page (no personal data). */
  async publicImpact() {
    const row = await one<Record<string, number>>(
      this.db,
      `SELECT (SELECT COALESCE(sum(a.handed_over_quantity), 0)::int FROM donation_allocations a JOIN donations d ON d.id = a.donation_id
                WHERE d.unit = 'MEALS' AND a.status IN ('PICKED_UP','IN_TRANSIT','COMPLETED')) AS "mealsRedistributed",
              (SELECT count(*)::int FROM handover_records WHERE status = 'CONFIRMED') AS "verifiedHandovers",
              (SELECT count(*)::int FROM donors WHERE verification_status = 'APPROVED') AS "verifiedDonors",
              (SELECT count(*)::int FROM ngos WHERE verification_status = 'APPROVED') AS "verifiedNgos",
              (SELECT COALESCE(sum(beneficiaries_served), 0)::int FROM delivery_confirmations) AS "beneficiariesServed"`,
    );
    return { ...row, dataLabel: await this.dataLabel(), generatedAt: new Date() };
  }

  async donor(auth: AuthContext) {
    if (!auth.donorId) throw forbidden();
    const id = auth.donorId;
    const [totals, monthly, categories, rewards, label] = await Promise.all([
      one<Record<string, number>>(
        this.db,
        `SELECT count(*)::int AS "donations",
                COALESCE(sum(d.quantity) FILTER (WHERE d.unit = 'MEALS'), 0)::int AS "mealsListed",
                (SELECT COALESCE(sum(a.handed_over_quantity), 0)::int FROM donation_allocations a JOIN donations x ON x.id = a.donation_id
                  WHERE x.donor_id = $1 AND x.unit = 'MEALS' AND a.status IN ('PICKED_UP','IN_TRANSIT','COMPLETED')) AS "mealsRedistributed",
                (SELECT count(*)::int FROM donation_allocations a JOIN donations x ON x.id = a.donation_id WHERE x.donor_id = $1 AND a.status = 'COMPLETED') AS "completedCollections",
                (SELECT count(*)::int FROM donation_allocations a JOIN donations x ON x.id = a.donation_id WHERE x.donor_id = $1 AND a.status IN ('CANCELLED','EXPIRED')) AS "failedCollections",
                count(*) FILTER (WHERE d.status IN ('AVAILABLE','PARTIALLY_RESERVED'))::int AS "openDonations",
                count(*) FILTER (WHERE d.status = 'EXPIRED')::int AS "expiredDonations"
           FROM donations d WHERE d.donor_id = $1 AND d.deleted_at IS NULL`,
        [id],
      ),
      many(
        this.db,
        `SELECT to_char(m, 'YYYY-MM') AS month,
                (SELECT count(*)::int FROM donations d WHERE d.donor_id = $1 AND date_trunc('month', d.created_at) = m) AS donations,
                (SELECT COALESCE(sum(a.handed_over_quantity), 0)::int FROM donation_allocations a JOIN donations d ON d.id = a.donation_id
                  WHERE d.donor_id = $1 AND a.handed_over_quantity IS NOT NULL AND date_trunc('month', a.updated_at) = m) AS "quantityRedistributed"
           FROM generate_series(date_trunc('month', now()) - make_interval(months => $2 - 1), date_trunc('month', now()), interval '1 month') m ORDER BY m`,
        [id, MONTHS],
      ),
      many(
        this.db,
        `SELECT c.name AS category, count(*)::int AS donations, COALESCE(sum(d.quantity), 0)::int AS quantity
           FROM donations d JOIN food_categories c ON c.id = d.category_id WHERE d.donor_id = $1 GROUP BY c.name ORDER BY quantity DESC`,
        [id],
      ),
      one<{ balance: number; lifetime_points: number }>(this.db, 'SELECT balance, lifetime_points FROM reward_balances WHERE donor_id = $1', [id]),
      this.dataLabel(),
    ]);
    const completed = totals?.completedCollections ?? 0;
    const failed = totals?.failedCollections ?? 0;
    return {
      totals,
      completionRate: completed + failed > 0 ? Math.round((completed / (completed + failed)) * 1000) / 10 : null,
      monthly,
      categories,
      rewards: { balance: rewards?.balance ?? 0, lifetimePoints: rewards?.lifetime_points ?? 0 },
      dataLabel: label,
    };
  }

  async ngo(auth: AuthContext) {
    const id = scopedNgoId(auth);
    if (!id) throw forbidden();
    const [totals, monthly, requests, fees, timing, label] = await Promise.all([
      one<Record<string, number>>(
        this.db,
        `SELECT COALESCE(sum(a.handed_over_quantity) FILTER (WHERE d.unit = 'MEALS' AND a.status IN ('PICKED_UP','IN_TRANSIT','COMPLETED')), 0)::int AS "mealsReceived",
                count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS "completedCollections",
                count(*) FILTER (WHERE a.status IN ('CANCELLED','EXPIRED'))::int AS "failedCollections",
                count(*) FILTER (WHERE a.status IN ('RESERVED','PICKUP_ASSIGNED','PICKED_UP','IN_TRANSIT'))::int AS "activeCollections",
                (SELECT COALESCE(sum(delivered_quantity), 0)::int FROM delivery_confirmations dc JOIN pickup_assignments p ON p.id = dc.pickup_assignment_id WHERE p.ngo_id = $1) AS "quantityDelivered",
                (SELECT COALESCE(sum(beneficiaries_served), 0)::int FROM delivery_confirmations dc JOIN pickup_assignments p ON p.id = dc.pickup_assignment_id WHERE p.ngo_id = $1) AS "beneficiariesServed"
           FROM donation_allocations a JOIN donations d ON d.id = a.donation_id WHERE a.ngo_id = $1`,
        [id],
      ),
      many(
        this.db,
        `SELECT to_char(m, 'YYYY-MM') AS month,
                (SELECT COALESCE(sum(a.handed_over_quantity), 0)::int FROM donation_allocations a WHERE a.ngo_id = $1 AND a.handed_over_quantity IS NOT NULL AND date_trunc('month', a.updated_at) = m) AS "quantityReceived",
                (SELECT COALESCE(sum(f.quantity_required), 0)::int FROM food_assistance_requests f WHERE f.ngo_id = $1 AND date_trunc('month', f.created_at) = m) AS "quantityRequested"
           FROM generate_series(date_trunc('month', now()) - make_interval(months => $2 - 1), date_trunc('month', now()), interval '1 month') m ORDER BY m`,
        [id, MONTHS],
      ),
      many(this.db, `SELECT status, count(*)::int AS count FROM food_assistance_requests WHERE ngo_id = $1 GROUP BY status`, [id]),
      one<Record<string, number>>(
        this.db,
        `SELECT COALESCE(sum(total_amount) FILTER (WHERE status <> 'VOID'), 0) AS "totalBilled",
                COALESCE(sum(total_amount) FILTER (WHERE status IN ('PENDING','INVOICED')), 0) AS "outstanding",
                COALESCE(sum(total_amount) FILTER (WHERE created_at >= date_trunc('month', now()) AND status <> 'VOID'), 0) AS "thisMonth"
           FROM ngo_billing WHERE ngo_id = $1`,
        [id],
      ),
      one<{ avg_minutes: number | null; n: number }>(
        this.db,
        `SELECT avg(EXTRACT(EPOCH FROM (handed_over_at - created_at)) / 60) AS avg_minutes, count(*)::int AS n
           FROM pickup_assignments WHERE ngo_id = $1 AND handed_over_at IS NOT NULL`,
        [id],
      ),
      this.dataLabel(),
    ]);
    const completed = totals?.completedCollections ?? 0;
    const failed = totals?.failedCollections ?? 0;
    return {
      totals,
      successfulCollectionRate: completed + failed > 0 ? Math.round((completed / (completed + failed)) * 1000) / 10 : null,
      monthly,
      assistanceRequestsByStatus: Object.fromEntries(requests.map((r) => [r.status as string, r.count as number])),
      fees,
      collectionPerformance: { averageMinutesAssignmentToHandover: timing?.avg_minutes === null || timing?.avg_minutes === undefined ? null : Math.round(timing.avg_minutes), sampleSize: timing?.n ?? 0 },
      dataLabel: label,
    };
  }

  async admin() {
    const [platform, donations, monthly, geo, matching, rewards, revenue, label] = await Promise.all([
      one<Record<string, number>>(
        this.db,
        `SELECT (SELECT count(*)::int FROM donors WHERE deleted_at IS NULL) AS "donors",
                (SELECT count(*)::int FROM donors WHERE verification_status = 'APPROVED') AS "verifiedDonors",
                (SELECT count(*)::int FROM ngos WHERE deleted_at IS NULL) AS "ngos",
                (SELECT count(*)::int FROM ngos WHERE verification_status = 'APPROVED') AS "verifiedNgos",
                (SELECT count(*)::int FROM donors WHERE verification_status = 'PENDING') + (SELECT count(*)::int FROM ngos WHERE verification_status = 'PENDING') AS "pendingVerifications",
                (SELECT count(*)::int FROM food_assistance_requests) AS "assistanceRequests",
                (SELECT count(*)::int FROM handover_records WHERE status = 'CONFIRMED') AS "successfulHandovers",
                (SELECT count(*)::int FROM pickup_assignments WHERE status = 'FAILED') AS "failedPickups",
                (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN','UNDER_REVIEW')) AS "openDisputes",
                (SELECT COALESCE(sum(a.handed_over_quantity), 0)::int FROM donation_allocations a JOIN donations d ON d.id = a.donation_id
                  WHERE d.unit = 'MEALS' AND a.status IN ('PICKED_UP','IN_TRANSIT','COMPLETED')) AS "mealsRedistributed"`,
      ),
      many(this.db, `SELECT status, count(*)::int AS count FROM donations WHERE deleted_at IS NULL GROUP BY status ORDER BY status`),
      many(
        this.db,
        `SELECT to_char(m, 'YYYY-MM') AS month,
                (SELECT count(*)::int FROM donations d WHERE date_trunc('month', d.created_at) = m) AS donations,
                (SELECT COALESCE(sum(a.handed_over_quantity), 0)::int FROM donation_allocations a WHERE a.handed_over_quantity IS NOT NULL AND date_trunc('month', a.updated_at) = m) AS "quantityRedistributed",
                (SELECT count(*)::int FROM food_assistance_requests f WHERE date_trunc('month', f.created_at) = m) AS "assistanceRequests"
           FROM generate_series(date_trunc('month', now()) - make_interval(months => $1 - 1), date_trunc('month', now()), interval '1 month') m ORDER BY m`,
        [MONTHS],
      ),
      many(
        this.db,
        `SELECT COALESCE(dn.city, 'Unknown') AS city, count(d.id)::int AS donations, COALESCE(sum(d.quantity), 0)::int AS quantity,
                avg(ST_Y(d.location::geometry)) AS lat, avg(ST_X(d.location::geometry)) AS lng
           FROM donations d JOIN donors dn ON dn.id = d.donor_id GROUP BY COALESCE(dn.city, 'Unknown') ORDER BY donations DESC LIMIT 20`,
      ),
      this.matchingPerformance(),
      one(
        this.db,
        `SELECT COALESCE(sum(points) FILTER (WHERE type = 'CREDIT'), 0)::int AS "pointsCredited", count(DISTINCT donor_id)::int AS "donorsRewarded" FROM reward_transactions`,
      ),
      one(
        this.db,
        SERVICE_FEE_REVENUE_SQL,
      ),
      this.dataLabel(),
    ]);
    return { platform, donationsByStatus: donations, monthly, geographicDistribution: geo, matching, rewards, serviceFeeRevenue: revenue, dataLabel: label };
  }

  async matchingPerformance() {
    const row = await one<Record<string, number>>(
      this.db,
      `SELECT count(DISTINCT run_id)::int AS "runs",
              count(DISTINCT run_id) FILTER (WHERE ranking_status = 'RANKING_UNAVAILABLE')::int AS "fallbackRuns",
              count(*) FILTER (WHERE eligible)::int AS "eligibleCandidates",
              count(*) FILTER (WHERE NOT eligible)::int AS "ineligibleCandidates",
              count(*) FILTER (WHERE notified_at IS NOT NULL)::int AS "notified",
              count(*) FILTER (WHERE response IN ('REQUESTED','OFFERED'))::int AS "positiveResponses",
              count(*) FILTER (WHERE response IN ('DECLINED','UNAVAILABLE'))::int AS "negativeResponses",
              round(avg(score) FILTER (WHERE eligible AND score IS NOT NULL), 1) AS "averageScore"
         FROM match_recommendations`,
    );
    const notified = row?.notified ?? 0;
    return { ...row, responseRate: notified > 0 ? Math.round(((row?.positiveResponses ?? 0) / notified) * 1000) / 10 : null };
  }

  /** AI service + model + forecast accuracy on real data, for the admin AI performance page. */
  async aiPerformance() {
    let health: unknown = null;
    try {
      health = await this.ai.health();
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) this.logger.warn({ err }, 'AI health failed');
    }
    const [models, accuracy, matching] = await Promise.all([
      many(this.db, `SELECT model_name AS "modelName", version, algorithm, training_data_label AS "trainingDataLabel", is_active AS "isActive", first_seen_at AS "firstSeenAt" FROM model_versions ORDER BY first_seen_at DESC LIMIT 20`),
      one<{ n: number; mae: number | null }>(
        this.db,
        `SELECT count(*)::int AS n, avg(abs(p.predicted_quantity - m.surplus_qty)) AS mae
           FROM surplus_predictions p JOIN restaurant_daily_metrics m ON m.donor_id = p.donor_id AND m.metric_date = p.target_date AND m.meal_period = p.meal_period
          WHERE p.status = 'OK' AND m.data_source <> 'SYNTHETIC'`,
      ),
      this.matchingPerformance(),
    ]);
    return {
      service: health ? { status: 'ok', ...(health as object) } : { status: 'unavailable' },
      models,
      liveForecastAccuracy: { sampleSize: accuracy?.n ?? 0, meanAbsoluteError: accuracy?.mae === null || accuracy?.mae === undefined ? null : Math.round(accuracy.mae * 10) / 10, note: 'Compares stored forecasts with surplus later recorded by donors (non-synthetic rows only).' },
      matching,
    };
  }

  /** Data-driven insights computed by the AI service from aggregated platform data, with sample-size guards. */
  async insights(auth: AuthContext) {
    const audience = auth.role === 'ADMIN' ? 'ADMIN' : auth.role === 'DONOR' ? 'DONOR' : 'NGO';
    const scopeDonor = audience === 'DONOR' ? auth.donorId : null;
    const scopeNgo = audience === 'NGO' ? scopedNgoId(auth) : null;
    const [weekday, unmet, collections, monthly, label] = await Promise.all([
      many<{ weekday: number; count: number; quantity: number }>(
        this.db,
        `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS weekday, count(*)::int AS count, COALESCE(sum(quantity), 0)::int AS quantity
           FROM donations WHERE ($1::uuid IS NULL OR donor_id = $1) AND created_at > now() - interval '180 days' GROUP BY 1 ORDER BY 1`,
        [scopeDonor],
      ),
      many<{ category_code: string; dietary_requirement: string; open_requests: number; quantity_remaining: number }>(
        this.db,
        `SELECT c.code AS category_code, f.dietary_requirement, count(*)::int AS open_requests, sum(f.quantity_required - f.quantity_committed)::int AS quantity_remaining
           FROM food_assistance_requests f JOIN food_categories c ON c.id = f.category_id
          WHERE f.status IN ('OPEN','PARTIALLY_FULFILLED') AND ($1::uuid IS NULL OR f.ngo_id = $1) GROUP BY c.code, f.dietary_requirement`,
        [scopeNgo],
      ),
      many<{ distance_m: number; delay_minutes: number }>(
        this.db,
        `SELECT ST_Distance(d.location, n.location) AS distance_m, EXTRACT(EPOCH FROM (p.handed_over_at - p.scheduled_pickup_at)) / 60 AS delay_minutes
           FROM pickup_assignments p JOIN donation_allocations a ON a.id = p.allocation_id JOIN donations d ON d.id = a.donation_id JOIN ngos n ON n.id = p.ngo_id
          WHERE p.handed_over_at IS NOT NULL AND p.scheduled_pickup_at IS NOT NULL AND n.location IS NOT NULL
            AND ($1::uuid IS NULL OR d.donor_id = $1) AND ($2::uuid IS NULL OR p.ngo_id = $2) LIMIT 2000`,
        [scopeDonor, scopeNgo],
      ),
      many<{ month: string; quantity: number; count: number }>(
        this.db,
        `SELECT to_char(date_trunc('month', a.updated_at), 'YYYY-MM') AS month, COALESCE(sum(a.handed_over_quantity), 0)::int AS quantity, count(*)::int AS count
           FROM donation_allocations a JOIN donations d ON d.id = a.donation_id
          WHERE a.handed_over_quantity IS NOT NULL AND a.updated_at > now() - interval '12 months' AND ($1::uuid IS NULL OR d.donor_id = $1) AND ($2::uuid IS NULL OR a.ngo_id = $2)
          GROUP BY 1 ORDER BY 1`,
        [scopeDonor, scopeNgo],
      ),
      this.dataLabel(),
    ]);
    try {
      const res = await this.ai.insights({
        audience,
        data_label: label,
        min_sample_size: 20,
        series: {
          donations_by_weekday: weekday,
          unmet_requests_by_category: unmet,
          collections: collections.map((c) => ({ distance_m: Math.round(c.distance_m), delay_minutes: Math.round(c.delay_minutes * 10) / 10 })),
          monthly_completed: monthly.map((m) => ({ month: m.month, quantity: m.quantity, count: m.count })),
        },
      });
      for (const i of res.insights) {
        await this.db.query(
          `INSERT INTO ai_insights (audience, donor_id, ngo_id, insight_type, title, body, supporting_data, sample_size, confidence, limitations, data_label, generated_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'RULE', now() + interval '1 day')`,
          [audience, scopeDonor, scopeNgo, i.type, i.title, i.body, JSON.stringify(i.supporting_data), Math.max(1, i.sample_size), i.confidence, i.limitations, label === 'REAL' ? 'REAL' : 'MIXED'],
        );
      }
      return { status: 'OK', insights: res.insights.map((i) => ({ type: i.type, title: i.title, body: i.body, sampleSize: i.sample_size, confidence: i.confidence, limitations: i.limitations, supportingData: i.supporting_data })), skipped: res.skipped, dataLabel: label };
    } catch (err) {
      if (err instanceof AiUnavailableError) return { status: 'UNAVAILABLE', insights: [], skipped: [], dataLabel: label, message: 'Insights are unavailable while the AI service is offline.' };
      throw err;
    }
  }
}
