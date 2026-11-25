import type { Logger } from '../config/logger.js';
import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import { insertDonationHistory } from '../repositories/donation.repository.js';
import { SYSTEM_ACTOR } from '../types/auth.js';
import type { AllocationService } from './allocation.service.js';
import { recordAudit } from './audit.service.js';
import type { NotificationRow, NotificationService } from './notification.service.js';

export const EXPIRY_JOB = 'expire-stale-records';
/** Unassigned reservations are released this long after the pickup deadline. */
const RESERVATION_GRACE_MINUTES = 30;

export interface ExpirySummary {
  donationsExpired: number;
  donationsPartiallyExpired: number;
  requestsExpired: number;
  allocationsExpired: number;
  assistanceRequestsExpired: number;
  offersExpired: number;
}

/**
 * Time-based lifecycle transitions. Each record is handled in its own
 * transaction so one failure never blocks the rest; the job is idempotent.
 */
export class ExpiryService {
  constructor(
    private readonly db: Database,
    private readonly allocations: AllocationService,
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<ExpirySummary> {
    const summary: ExpirySummary = { donationsExpired: 0, donationsPartiallyExpired: 0, requestsExpired: 0, allocationsExpired: 0, assistanceRequestsExpired: 0, offersExpired: 0 };
    const notices: (NotificationRow | null)[] = [];

    // 1. Pending NGO requests on donations whose deadline passed.
    const reqs = await this.db.query(
      `UPDATE donation_requests r SET status = 'EXPIRED', decision_reason = 'pickup deadline passed'
         FROM donations d WHERE d.id = r.donation_id AND r.status = 'PENDING' AND d.pickup_deadline <= now()`,
    );
    summary.requestsExpired = reqs.rowCount ?? 0;

    // 2. Reservations never assigned for pickup, past deadline + grace.
    const stale = await many<{ id: string }>(
      this.db,
      `SELECT a.id FROM donation_allocations a JOIN donations d ON d.id = a.donation_id
        WHERE a.status = 'RESERVED' AND d.pickup_deadline <= now() - make_interval(mins => $1)`,
      [RESERVATION_GRACE_MINUTES],
    );
    for (const a of stale) {
      try {
        notices.push(...(await this.db.transaction((tx) => this.allocations.releaseAllocation(tx, a.id, { status: 'EXPIRED', party: 'SYSTEM', reason: 'no pickup was assigned before the deadline' }, SYSTEM_ACTOR))));
        summary.allocationsExpired += 1;
      } catch (err) {
        this.logger.warn({ err, allocationId: a.id }, 'allocation expiry failed');
      }
    }

    // 3. Donations past their deadline: unreserved quantity expires.
    const donations = await many<{ id: string }>(
      this.db,
      `SELECT id FROM donations WHERE status IN ('AVAILABLE','PARTIALLY_RESERVED') AND pickup_deadline <= now() AND deleted_at IS NULL`,
    );
    for (const { id } of donations) {
      try {
        const outcome = await this.db.transaction(async (tx) => {
          const d = await one<{ status: string; quantity: number; reserved_quantity: number; expired_quantity: number; owner: string; food_name: string }>(
            tx,
            `SELECT d.status, d.quantity, d.reserved_quantity, d.expired_quantity, dn.owner_user_id AS owner, d.food_name
               FROM donations d JOIN donors dn ON dn.id = d.donor_id WHERE d.id = $1 FOR UPDATE OF d`,
            [id],
          );
          if (!d || !['AVAILABLE', 'PARTIALLY_RESERVED'].includes(d.status)) return null;
          const unreserved = d.quantity - d.reserved_quantity;
          await tx.query('UPDATE donations SET expired_quantity = $2 WHERE id = $1', [id, unreserved]);
          if (d.reserved_quantity === 0) {
            await tx.query(`UPDATE donations SET status = 'EXPIRED', version = version + 1 WHERE id = $1`, [id]);
            await insertDonationHistory(tx, id, d.status, 'EXPIRED', null, 'pickup deadline passed with no reservation');
          } else {
            await this.allocations.rollupDonationStatus(tx, id, null, `pickup deadline passed; ${unreserved} unreserved expired`);
          }
          await recordAudit(tx, SYSTEM_ACTOR, { action: 'donation.expired', entityType: 'donation', entityId: id, changes: { expiredQuantity: unreserved } });
          const n = await this.notifications.create(tx, {
            userId: d.owner,
            type: 'DONATION_EXPIRED',
            title: d.reserved_quantity === 0 ? 'Donation expired' : 'Unreserved food expired',
            body:
              d.reserved_quantity === 0
                ? `"${d.food_name}" reached its pickup deadline without being reserved.`
                : `${unreserved} unreserved units of "${d.food_name}" expired at the pickup deadline. Reserved units are unaffected.`,
            linkPath: `/donor/donations/${id}`,
            dedupeKey: `donation-expired:${id}`,
          });
          return { full: d.reserved_quantity === 0, n };
        });
        if (outcome) {
          notices.push(outcome.n);
          if (outcome.full) summary.donationsExpired += 1;
          else summary.donationsPartiallyExpired += 1;
        }
      } catch (err) {
        this.logger.warn({ err, donationId: id }, 'donation expiry failed');
      }
    }

    // 4. Offers that were never confirmed before their pickup deadline or the request window.
    const offers = await many<{ id: string; request_id: string; status: string; accepted_quantity: number | null }>(
      this.db,
      `SELECT o.id, o.assistance_request_id AS request_id, o.status, o.accepted_quantity
         FROM assistance_offers o JOIN food_assistance_requests f ON f.id = o.assistance_request_id
        WHERE o.status IN ('PROPOSED','ACCEPTED') AND (o.pickup_deadline <= now() OR f.needed_until <= now())`,
    );
    for (const o of offers) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.query('SELECT 1 FROM food_assistance_requests WHERE id = $1 FOR UPDATE', [o.request_id]);
          const cur = await one<{ status: string; accepted_quantity: number | null }>(tx, 'SELECT status, accepted_quantity FROM assistance_offers WHERE id = $1 FOR UPDATE', [o.id]);
          if (!cur || !['PROPOSED', 'ACCEPTED'].includes(cur.status)) return;
          await tx.query(`UPDATE assistance_offers SET status = 'EXPIRED' WHERE id = $1`, [o.id]);
          if (cur.status === 'ACCEPTED' && cur.accepted_quantity) {
            await this.allocations.adjustRequestCommitment(tx, o.request_id, -cur.accepted_quantity, SYSTEM_ACTOR, o.id, 'OFFER_EXPIRED');
          }
        });
        summary.offersExpired += 1;
      } catch (err) {
        this.logger.warn({ err, offerId: o.id }, 'offer expiry failed');
      }
    }

    // 5. Assistance requests whose window has passed.
    const expiredRequests = await many<{ id: string; status: string }>(
      this.db,
      `UPDATE food_assistance_requests SET status = 'EXPIRED', version = version + 1
        WHERE status IN ('OPEN','PARTIALLY_FULFILLED') AND needed_until <= now()
        RETURNING id, 'EXPIRED' AS status`,
    );
    for (const r of expiredRequests) {
      await this.db.query(
        `INSERT INTO assistance_request_history (assistance_request_id, event_type, to_status) VALUES ($1, 'STATUS_CHANGED', 'EXPIRED')`,
        [r.id],
      );
    }
    summary.assistanceRequestsExpired = expiredRequests.length;

    this.notifications.publish(notices);
    if (Object.values(summary).some((n) => n > 0)) this.logger.info({ summary }, 'expiry sweep');
    return summary;
  }
}
