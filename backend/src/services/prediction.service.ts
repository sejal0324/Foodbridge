import type { Logger } from '../config/logger.js';
import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { AiRequestError, AiUnavailableError, type AiClient, type PredictResponse } from '../integrations/ai-client.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { forbidden, serviceUnavailable } from '../utils/errors.js';
import { localDate } from '../utils/format.js';
import { recordAudit } from './audit.service.js';

export const FORECAST_JOB = 'generate-forecasts';
type MealPeriod = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'ALL_DAY';

export interface MetricInput {
  date: string;
  mealPeriod: MealPeriod;
  preparedQty: number;
  soldQty: number;
  surplusQty: number;
  isHoliday?: boolean | undefined;
  specialEvent?: string | undefined;
}

/**
 * Surplus forecasting. The donor's own history is sent to the stateless AI
 * service; forecasts are stored with the model version and a data label.
 * A forecast is never a donation — only donor-confirmed food is.
 */
export class PredictionService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiClient,
    private readonly logger: Logger,
  ) {}

  async upsertMetric(auth: AuthContext, m: MetricInput, actor: Actor) {
    if (!auth.donorId) throw forbidden();
    await this.db.query(
      `INSERT INTO restaurant_daily_metrics (donor_id, metric_date, meal_period, prepared_qty, sold_qty, surplus_qty, is_holiday, special_event, data_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DONOR_ENTERED')
       ON CONFLICT (donor_id, metric_date, meal_period) DO UPDATE SET prepared_qty = EXCLUDED.prepared_qty, sold_qty = EXCLUDED.sold_qty,
         surplus_qty = EXCLUDED.surplus_qty, is_holiday = EXCLUDED.is_holiday, special_event = EXCLUDED.special_event, data_source = 'DONOR_ENTERED'`,
      [auth.donorId, m.date, m.mealPeriod, m.preparedQty, m.soldQty, m.surplusQty, m.isHoliday ?? false, m.specialEvent ?? null],
    );
    await recordAudit(this.db, actor, { action: 'metrics.recorded', entityType: 'donor', entityId: auth.donorId, metadata: { date: m.date, mealPeriod: m.mealPeriod } });
    return this.listMetrics(auth, 90);
  }

  async listMetrics(auth: AuthContext, days: number) {
    if (!auth.donorId) throw forbidden();
    return many(
      this.db,
      `SELECT metric_date AS date, meal_period AS "mealPeriod", prepared_qty AS "preparedQty", sold_qty AS "soldQty", surplus_qty AS "surplusQty",
              is_holiday AS "isHoliday", special_event AS "specialEvent", data_source AS "dataSource"
         FROM restaurant_daily_metrics WHERE donor_id = $1 AND metric_date >= current_date - $2::int ORDER BY metric_date DESC, meal_period`,
      [auth.donorId, days],
    );
  }

  private async history(q: Queryable, donorId: string) {
    return many<{ date: string; meal_period: MealPeriod; prepared_qty: number; sold_qty: number; surplus_qty: number; is_holiday: boolean; special_event: string | null; data_source: string }>(
      q,
      `SELECT metric_date AS date, meal_period, prepared_qty, sold_qty, surplus_qty, is_holiday, special_event, data_source
         FROM restaurant_daily_metrics WHERE donor_id = $1 AND unit = 'MEALS' AND metric_date >= current_date - 365 ORDER BY metric_date DESC LIMIT 1500`,
      [donorId],
    );
  }

  /** Records the model version the AI service reported (first sighting) and marks it active. */
  private async recordModel(model: PredictResponse['model']): Promise<string> {
    const row = await one<{ id: string }>(
      this.db,
      `INSERT INTO model_versions (model_name, version, algorithm, training_data_label, is_active)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (model_name, version) DO UPDATE SET algorithm = EXCLUDED.algorithm RETURNING id`,
      [model.name, model.version, model.algorithm, model.training_data_label === 'REAL' || model.training_data_label === 'MIXED' ? model.training_data_label : 'SYNTHETIC'],
    );
    const id = row?.id as string;
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE model_versions SET is_active = false WHERE model_name = $1 AND id <> $2 AND is_active', [model.name, id]);
      await tx.query('UPDATE model_versions SET is_active = true WHERE id = $1', [id]);
    });
    return id;
  }

  /** Forecast for the donor's next days. Returns status UNAVAILABLE (never a guessed number) if the AI service is down. */
  async forecast(donorId: string, targets: { date: string; mealPeriod: MealPeriod }[]) {
    const history = await this.history(this.db, donorId);
    const sources = new Set(history.map((h) => h.data_source));
    const dataLabel = sources.size === 0 ? 'REAL' : sources.has('SYNTHETIC') ? (sources.size === 1 ? 'SYNTHETIC' : 'MIXED') : 'REAL';
    let response: PredictResponse;
    try {
      response = await this.ai.predictSurplus({
        donor_id: donorId,
        unit: 'MEALS',
        history: history.map((h) => ({
          date: h.date,
          meal_period: h.meal_period,
          prepared_qty: h.prepared_qty,
          sold_qty: h.sold_qty,
          surplus_qty: h.surplus_qty,
          is_holiday: h.is_holiday,
          special_event: h.special_event,
        })),
        targets: targets.map((t) => ({ date: t.date, meal_period: t.mealPeriod, is_holiday: false, special_event: null, planned_prepared_qty: null })),
      });
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        return { status: 'UNAVAILABLE' as const, message: 'Surplus forecast is unavailable right now. Core features keep working.', predictions: [], historyDays: history.length, dataLabel };
      }
      if (err instanceof AiRequestError) {
        this.logger.warn({ err: err.message }, 'forecast request rejected');
        return { status: 'UNAVAILABLE' as const, message: 'The forecast could not be computed from the available history.', predictions: [], historyDays: history.length, dataLabel };
      }
      throw err;
    }
    const modelId = await this.recordModel(response.model);
    for (const p of response.predictions) {
      await this.db.query(
        `INSERT INTO surplus_predictions (donor_id, target_date, meal_period, status, predicted_quantity, lower_bound, upper_bound, basis, model_version_id, input_summary, data_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          donorId,
          p.date,
          p.meal_period,
          p.status === 'ok' ? 'OK' : 'INSUFFICIENT_HISTORY',
          p.predicted_qty,
          p.lower_qty,
          p.upper_qty,
          p.basis,
          modelId,
          JSON.stringify({ historyRows: history.length }),
          dataLabel,
        ],
      );
    }
    return {
      status: 'OK' as const,
      model: { name: response.model.name, version: response.model.version, algorithm: response.model.algorithm, trainingDataLabel: response.model.training_data_label },
      predictions: response.predictions.map((p) => ({
        date: p.date,
        mealPeriod: p.meal_period,
        status: p.status === 'ok' ? 'OK' : 'INSUFFICIENT_HISTORY',
        predictedQuantity: p.predicted_qty,
        lowerBound: p.lower_qty,
        upperBound: p.upper_qty,
        basis: p.basis,
      })),
      limitations: response.limitations,
      minHistoryDays: response.min_history_days,
      historyDays: history.length,
      dataLabel,
      notice: 'A forecast is an estimate, not a donation. Only food you confirm can be offered or listed.',
    };
  }

  async forecastForDonor(auth: AuthContext, date?: string) {
    if (!auth.donorId) throw forbidden();
    const days = date ? [date] : [0, 1].map((d) => localDate(new Date(Date.now() + d * 86_400_000)));
    const targets = days.flatMap((d) => (['LUNCH', 'DINNER'] as const).map((mealPeriod) => ({ date: d, mealPeriod })));
    return this.forecast(auth.donorId, targets);
  }

  /** Past forecasts next to actual recorded surplus (shows real forecast accuracy to the donor). */
  async accuracy(auth: AuthContext) {
    if (!auth.donorId) throw forbidden();
    const rows = await many<{ date: string; meal_period: string; predicted: number; actual: number }>(
      this.db,
      `SELECT DISTINCT ON (p.target_date, p.meal_period) p.target_date AS date, p.meal_period, p.predicted_quantity AS predicted, m.surplus_qty AS actual
         FROM surplus_predictions p JOIN restaurant_daily_metrics m ON m.donor_id = p.donor_id AND m.metric_date = p.target_date AND m.meal_period = p.meal_period
        WHERE p.donor_id = $1 AND p.status = 'OK' AND p.created_at::date <= p.target_date
        ORDER BY p.target_date DESC, p.meal_period, p.created_at DESC LIMIT 60`,
      [auth.donorId],
    );
    const mae = rows.length ? rows.reduce((s, r) => s + Math.abs(r.predicted - r.actual), 0) / rows.length : null;
    return { comparisons: rows.map((r) => ({ date: r.date, mealPeriod: r.meal_period, predicted: r.predicted, actual: r.actual })), meanAbsoluteError: mae === null ? null : Math.round(mae * 10) / 10, sampleSize: rows.length };
  }

  /** Background job: forecasts tomorrow for donors with enough history, so request matching can use predicted surplus. */
  async forecastAllDonors(): Promise<number> {
    const donors = await many<{ donor_id: string }>(
      this.db,
      `SELECT m.donor_id FROM restaurant_daily_metrics m JOIN donors d ON d.id = m.donor_id
        WHERE d.verification_status = 'APPROVED' AND m.metric_date >= current_date - 60 GROUP BY m.donor_id HAVING count(*) >= 14`,
    );
    const tomorrow = localDate(new Date(Date.now() + 86_400_000));
    let done = 0;
    for (const d of donors) {
      const result = await this.forecast(d.donor_id, [
        { date: tomorrow, mealPeriod: 'LUNCH' },
        { date: tomorrow, mealPeriod: 'DINNER' },
      ]);
      if (result.status === 'UNAVAILABLE') throw serviceUnavailable('AI service unavailable for forecasts');
      done += 1;
    }
    return done;
  }
}
