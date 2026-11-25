import PDFDocument from 'pdfkit';
import type { Database, Queryable } from '../db/database.js';
import { many, one } from '../db/database.js';
import { calculateRewardPoints, tierFor, type RewardRule, type Unit } from '../domain/rewards.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';

export interface CreditResult {
  transactionId: string;
  points: number;
  duplicate: boolean;
  notice: NotificationRow | null;
}

/**
 * FoodBridge Rewards: an immutable, idempotent points ledger. Points are only
 * ever credited by backend business logic for a two-way confirmed handover,
 * using the confirmed quantity and the configurable reward rules.
 */
export class RewardService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationService,
  ) {}

  async activeRules(q: Queryable = this.db): Promise<RewardRule[]> {
    const rows = await many<{ id: string; unit: Unit; basis: 'PER_UNIT' | 'PER_ORDER'; points: number; lifetime_threshold: number }>(
      q,
      `SELECT id, unit, basis, points, lifetime_threshold FROM reward_rules
        WHERE is_active AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())`,
    );
    return rows.map((r) => ({ id: r.id, unit: r.unit, basis: r.basis, points: r.points, lifetimeThreshold: r.lifetime_threshold }));
  }

  /**
   * Credits the donor for a CONFIRMED handover. Safe to call repeatedly: the
   * unique idempotency key means a retry returns the existing credit without
   * touching the balance. Must run inside the handover transaction.
   */
  async creditForHandover(tx: Queryable, handoverId: string, quantity: number, actor: Actor): Promise<CreditResult> {
    const h = await one<{ status: string; donor_id: string; donor_owner: string; unit: Unit; food_name: string }>(
      tx,
      `SELECT hr.status, d.donor_id, dn.owner_user_id AS donor_owner, d.unit, d.food_name
         FROM handover_records hr JOIN donation_allocations a ON a.id = hr.allocation_id JOIN donations d ON d.id = a.donation_id JOIN donors dn ON dn.id = d.donor_id
        WHERE hr.id = $1`,
      [handoverId],
    );
    if (!h) throw notFound('Handover');
    if (h.status !== 'CONFIRMED') throw conflict('Points are only awarded for a two-way confirmed handover.', 'HANDOVER_NOT_CONFIRMED');
    const key = `handover:${handoverId}:credit`;
    const existing = await one<{ id: string; points: number }>(tx, 'SELECT id, points FROM reward_transactions WHERE idempotency_key = $1', [key]);
    if (existing) return { transactionId: existing.id, points: existing.points, duplicate: true, notice: null };

    // Serialise credits per donor so lifetime brackets (e.g. the 500-meal threshold) split correctly.
    await tx.query('INSERT INTO reward_balances (donor_id) VALUES ($1) ON CONFLICT (donor_id) DO NOTHING', [h.donor_id]);
    const bal = await one<{ balance: number; lifetime_points: number; lifetime_meals: number }>(
      tx,
      'SELECT balance, lifetime_points, lifetime_meals FROM reward_balances WHERE donor_id = $1 FOR UPDATE',
      [h.donor_id],
    );
    const rules = await this.activeRules(tx);
    const calc = calculateRewardPoints({ unit: h.unit, quantity, lifetimeQuantityBefore: h.unit === 'MEALS' ? (bal?.lifetime_meals ?? 0) : 0, rules });
    if (calc.points <= 0) return { transactionId: '', points: 0, duplicate: false, notice: null };
    const balanceAfter = (bal?.balance ?? 0) + calc.points;
    const tx1 = await one<{ id: string }>(
      tx,
      `INSERT INTO reward_transactions (donor_id, type, points, balance_after, unit, quantity, reference_type, reference_id, idempotency_key, calculation, description, created_by)
       VALUES ($1, 'CREDIT', $2, $3, $4, $5, 'HANDOVER', $6, $7, $8, $9, NULL)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [
        h.donor_id,
        calc.points,
        balanceAfter,
        h.unit,
        quantity,
        handoverId,
        key,
        JSON.stringify({ lines: calc.lines, lifetimeMealsBefore: bal?.lifetime_meals ?? 0 }),
        `Verified handover: ${quantity} ${h.unit.toLowerCase()} of ${h.food_name}`,
      ],
    );
    if (!tx1) {
      const again = await one<{ id: string; points: number }>(tx, 'SELECT id, points FROM reward_transactions WHERE idempotency_key = $1', [key]);
      return { transactionId: again?.id ?? '', points: again?.points ?? 0, duplicate: true, notice: null };
    }
    await tx.query(
      `UPDATE reward_balances SET balance = balance + $2, lifetime_points = lifetime_points + $2,
              lifetime_meals = lifetime_meals + $3, lifetime_orders = lifetime_orders + 1 WHERE donor_id = $1`,
      [h.donor_id, calc.points, h.unit === 'MEALS' ? quantity : 0],
    );
    await recordAudit(tx, actor, { action: 'reward.credited', entityType: 'reward_transaction', entityId: tx1.id, metadata: { donorId: h.donor_id, points: calc.points, handoverId } });
    const notice = await this.notifications.create(tx, {
      userId: h.donor_owner,
      type: 'REWARD_CREDITED',
      title: `+${calc.points} FoodBridge points`,
      body: `Thank you! ${quantity} ${h.unit.toLowerCase()} of ${h.food_name} were handed over and verified. You earned ${calc.points} points.`,
      linkPath: '/donor/rewards',
      dedupeKey: `reward:${handoverId}`,
    });
    return { transactionId: tx1.id, points: calc.points, duplicate: false, notice };
  }

  async balance(auth: AuthContext) {
    if (!auth.donorId) throw forbidden();
    const bal = await one<{ balance: number; lifetime_points: number; lifetime_meals: number; lifetime_orders: number }>(
      this.db,
      'SELECT balance, lifetime_points, lifetime_meals, lifetime_orders FROM reward_balances WHERE donor_id = $1',
      [auth.donorId],
    );
    const tiers = await many<{ name: string; min_lifetime_points: number; benefits: string }>(this.db, 'SELECT name, min_lifetime_points, benefits FROM reward_tiers ORDER BY sort_order');
    const lifetime = bal?.lifetime_points ?? 0;
    const { current, next } = tierFor(lifetime, tiers.map((t) => ({ name: t.name, minLifetimePoints: t.min_lifetime_points })));
    const rules = await this.activeRules();
    const meals = bal?.lifetime_meals ?? 0;
    const upgrade = rules.filter((r) => r.unit === 'MEALS' && r.basis === 'PER_UNIT' && r.lifetimeThreshold > meals).sort((a, b) => a.lifetimeThreshold - b.lifetimeThreshold)[0];
    return {
      balance: bal?.balance ?? 0,
      lifetimePoints: lifetime,
      lifetimeMeals: meals,
      lifetimeOrders: bal?.lifetime_orders ?? 0,
      tier: current ? { name: current.name, benefits: tiers.find((t) => t.name === current.name)?.benefits } : null,
      nextTier: next ? { name: next.name, pointsNeeded: next.minLifetimePoints - lifetime } : null,
      nextRateUpgrade: upgrade ? { mealsNeeded: upgrade.lifetimeThreshold - meals, pointsPerMeal: upgrade.points } : null,
      rules: rules.map((r) => ({ unit: r.unit, basis: r.basis, points: r.points, lifetimeThreshold: r.lifetimeThreshold })),
    };
  }

  async history(auth: AuthContext, page: number, pageSize: number) {
    if (!auth.donorId) throw forbidden();
    const rows = await many<Record<string, unknown>>(
      this.db,
      `SELECT id, type, points, balance_after, unit, quantity, reference_type, reference_id, calculation, description, created_at
         FROM reward_transactions WHERE donor_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [auth.donorId, pageSize, (page - 1) * pageSize],
    );
    const total = await one<{ n: number }>(this.db, 'SELECT count(*) AS n FROM reward_transactions WHERE donor_id = $1', [auth.donorId]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        points: r.points,
        balanceAfter: r.balance_after,
        unit: r.unit,
        quantity: r.quantity,
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        calculation: r.calculation,
        description: r.description,
        createdAt: r.created_at,
      })),
      total: total?.n ?? 0,
    };
  }

  /** Monthly leaderboard. Names are shown only for donors who consented to public recognition. */
  async leaderboard(auth: AuthContext, month?: string) {
    const start = month ? `${month}-01` : null;
    const rows = await many<{ donor_id: string; business_name: string; consent: boolean; points: number; meals: number }>(
      this.db,
      `SELECT t.donor_id, d.business_name, d.public_recognition_consent AS consent, sum(t.points)::int AS points,
              COALESCE(sum(t.quantity) FILTER (WHERE t.unit = 'MEALS'), 0)::int AS meals
         FROM reward_transactions t JOIN donors d ON d.id = t.donor_id
        WHERE t.type = 'CREDIT' AND t.created_at >= COALESCE($1::date, date_trunc('month', now())) AND t.created_at < COALESCE($1::date, date_trunc('month', now())) + interval '1 month'
        GROUP BY t.donor_id, d.business_name, d.public_recognition_consent
        ORDER BY points DESC LIMIT 20`,
      [start],
    );
    return rows.map((r, i) => ({
      rank: i + 1,
      donorName: r.consent || r.donor_id === auth.donorId || auth.role === 'ADMIN' ? r.business_name : 'Anonymous donor',
      isYou: r.donor_id === auth.donorId,
      points: r.points,
      mealsRedistributed: r.meals,
    }));
  }

  /** Issues (or returns) an impact certificate for a period, backed by the ledger. */
  async issueCertificate(auth: AuthContext, periodStart: string, periodEnd: string, actor: Actor) {
    if (!auth.donorId) throw forbidden();
    if (periodEnd < periodStart) throw unprocessable('periodEnd must not be before periodStart.', 'INVALID_PERIOD');
    const existing = await one<{ id: string }>(this.db, 'SELECT id FROM impact_certificates WHERE donor_id = $1 AND period_start = $2 AND period_end = $3', [auth.donorId, periodStart, periodEnd]);
    if (existing) return this.certificate(auth, existing.id);
    const stats = await one<{ meals: number; orders: number; points: number }>(
      this.db,
      `SELECT COALESCE(sum(quantity) FILTER (WHERE unit = 'MEALS'), 0)::int AS meals, count(*)::int AS orders, COALESCE(sum(points), 0)::int AS points
         FROM reward_transactions WHERE donor_id = $1 AND type = 'CREDIT' AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      [auth.donorId, periodStart, periodEnd],
    );
    if (!stats || stats.orders === 0) throw unprocessable('There are no verified handovers in this period.', 'NO_VERIFIED_HANDOVERS');
    const donor = await one<{ business_name: string }>(this.db, 'SELECT business_name FROM donors WHERE id = $1', [auth.donorId]);
    const id = await this.db.transaction(async (tx) => {
      const seq = await one<{ n: number }>(tx, `SELECT nextval('impact_certificate_number_seq') AS n`);
      const number = `FB-CERT-${new Date().getFullYear()}-${String(seq?.n ?? 0).padStart(6, '0')}`;
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO impact_certificates (donor_id, certificate_number, period_start, period_end, meals_redistributed, orders_completed, points_earned, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [auth.donorId, number, periodStart, periodEnd, stats.meals, stats.orders, stats.points, JSON.stringify({ donorName: donor?.business_name, ...stats })],
      );
      await recordAudit(tx, actor, { action: 'reward.certificate_issued', entityType: 'impact_certificate', entityId: row?.id, metadata: { number } });
      return row?.id as string;
    });
    return this.certificate(auth, id);
  }

  async certificates(auth: AuthContext) {
    if (!auth.donorId) throw forbidden();
    const rows = await many<Record<string, unknown>>(
      this.db,
      'SELECT id, certificate_number, period_start, period_end, meals_redistributed, orders_completed, points_earned, issued_at FROM impact_certificates WHERE donor_id = $1 ORDER BY issued_at DESC',
      [auth.donorId],
    );
    return rows.map((r) => ({
      id: r.id,
      certificateNumber: r.certificate_number,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      mealsRedistributed: r.meals_redistributed,
      ordersCompleted: r.orders_completed,
      pointsEarned: r.points_earned,
      issuedAt: r.issued_at,
    }));
  }

  async certificate(auth: AuthContext, id: string) {
    const c = (await this.certificates(auth)).find((x) => x.id === id);
    if (!c) throw notFound('Certificate');
    return c;
  }

  async certificatePdf(auth: AuthContext, id: string): Promise<Buffer> {
    const c = await this.certificate(auth, id);
    const donor = await one<{ business_name: string }>(this.db, 'SELECT business_name FROM donors WHERE id = $1', [auth.donorId]);
    return renderPdf((doc) => {
      doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(2).stroke('#2E7D32');
      doc.moveDown(3).fillColor('#2E7D32').fontSize(28).text('Certificate of Impact', { align: 'center' });
      doc.moveDown(0.5).fillColor('#333').fontSize(12).text('FoodBridge AI — Predict. Match. Redistribute.', { align: 'center' });
      doc.moveDown(2).fontSize(14).text('This certifies that', { align: 'center' });
      doc.moveDown(0.5).fontSize(22).fillColor('#000').text(donor?.business_name ?? '', { align: 'center' });
      doc.moveDown(1).fontSize(13).fillColor('#333').text(
        `redistributed ${c.mealsRedistributed} verified meals across ${c.ordersCompleted} verified handovers between ${c.periodStart} and ${c.periodEnd}, earning ${c.pointsEarned} FoodBridge points.`,
        { align: 'center', width: doc.page.width - 160, indent: 0 },
      );
      doc.moveDown(2).fontSize(10).text(`Certificate number: ${c.certificateNumber}`, { align: 'center' });
      doc.text(`Issued: ${new Date(c.issuedAt as string).toISOString().slice(0, 10)}`, { align: 'center' });
      doc.moveDown(1).fontSize(8).fillColor('#666').text('Quantities are those confirmed by both donor and NGO at handover.', { align: 'center' });
    }, { layout: 'landscape' });
  }

  // --- Admin configuration -------------------------------------------------

  async listRules() {
    return many(this.db, 'SELECT id, unit, basis, points, lifetime_threshold AS "lifetimeThreshold", description, effective_from AS "effectiveFrom", effective_to AS "effectiveTo", is_active AS "isActive" FROM reward_rules ORDER BY unit, lifetime_threshold, effective_from DESC');
  }

  /** Replaces the active rule for (unit, threshold) with a new version; history stays in the table. */
  async upsertRule(input: { unit: Unit; basis: 'PER_UNIT' | 'PER_ORDER'; points: number; lifetimeThreshold: number; description?: string | undefined }, actor: Actor) {
    if (input.basis === 'PER_ORDER' && input.lifetimeThreshold !== 0) throw unprocessable('Per-order rules cannot have a lifetime threshold.', 'INVALID_RULE');
    return this.db.transaction(async (tx) => {
      const prev = await many<{ id: string }>(
        tx,
        `UPDATE reward_rules SET is_active = false, effective_to = now() WHERE unit = $1 AND lifetime_threshold = $2 AND is_active RETURNING id`,
        [input.unit, input.lifetimeThreshold],
      );
      if (input.basis === 'PER_ORDER') {
        await tx.query(`UPDATE reward_rules SET is_active = false, effective_to = now() WHERE unit = $1 AND basis = 'PER_UNIT' AND is_active`, [input.unit]);
      } else {
        await tx.query(`UPDATE reward_rules SET is_active = false, effective_to = now() WHERE unit = $1 AND basis = 'PER_ORDER' AND is_active`, [input.unit]);
      }
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO reward_rules (unit, basis, points, lifetime_threshold, description, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.unit, input.basis, input.points, input.lifetimeThreshold, input.description ?? null, actor.userId],
      );
      await recordAudit(tx, actor, { action: 'reward.rule_changed', entityType: 'reward_rule', entityId: row?.id, changes: { ...input, replaced: prev.map((p) => p.id) } });
      return row;
    });
  }

  async deactivateRule(id: string, actor: Actor) {
    await this.db.transaction(async (tx) => {
      const res = await tx.query('UPDATE reward_rules SET is_active = false, effective_to = now() WHERE id = $1 AND is_active', [id]);
      if (res.rowCount === 0) throw notFound('Active reward rule');
      await recordAudit(tx, actor, { action: 'reward.rule_deactivated', entityType: 'reward_rule', entityId: id });
    });
  }

  /** Admin correction: a new ADJUSTMENT row (never an edit). Cannot drive the balance negative. */
  async adjust(donorId: string, points: number, reason: string, actor: Actor) {
    if (points === 0) throw unprocessable('Adjustment must be non-zero.', 'INVALID_ADJUSTMENT');
    return this.db.transaction(async (tx) => {
      await tx.query('INSERT INTO reward_balances (donor_id) VALUES ($1) ON CONFLICT (donor_id) DO NOTHING', [donorId]);
      const bal = await one<{ balance: number }>(tx, 'SELECT balance FROM reward_balances WHERE donor_id = $1 FOR UPDATE', [donorId]);
      const after = (bal?.balance ?? 0) + points;
      if (after < 0) throw unprocessable('Adjustment would make the balance negative.', 'NEGATIVE_BALANCE');
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO reward_transactions (donor_id, type, points, balance_after, reference_type, reference_id, idempotency_key, description, created_by)
         VALUES ($1, 'ADJUSTMENT', $2, $3, 'ADMIN_ADJUSTMENT', gen_random_uuid(), 'adjust:' || gen_random_uuid(), $4, $5) RETURNING id`,
        [donorId, points, after, reason, actor.userId],
      );
      await tx.query(
        'UPDATE reward_balances SET balance = $2, lifetime_points = lifetime_points + GREATEST($3, 0) WHERE donor_id = $1',
        [donorId, after, points],
      );
      await recordAudit(tx, actor, { action: 'reward.adjusted', entityType: 'reward_transaction', entityId: row?.id, changes: { donorId, points, reason } });
      return { id: row?.id, balanceAfter: after };
    });
  }

  async stats() {
    return one(
      this.db,
      `SELECT COALESCE(sum(points) FILTER (WHERE type = 'CREDIT'), 0)::int AS "pointsCredited",
              count(*) FILTER (WHERE type = 'CREDIT')::int AS "credits",
              count(DISTINCT donor_id)::int AS "donorsRewarded"
         FROM reward_transactions`,
    );
  }
}

/** Renders a PDF in memory with pdfkit's built-in fonts (no external assets). */
export function renderPdf(draw: (doc: PDFKit.PDFDocument) => void, options: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'FoodBridge AI', Producer: 'FoodBridge AI' }, ...options });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}
