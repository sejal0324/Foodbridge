import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFrom, requireAuth } from '../middleware/request-context.js';
import type { BillingService } from '../services/billing.service.js';
import type { PickupService } from '../services/pickup.service.js';
import type { RepresentativeService } from '../services/representative.service.js';
import type { RewardService } from '../services/reward.service.js';
import type { TrackingService } from '../services/tracking.service.js';
import { badRequest } from '../utils/errors.js';
import { created, noContent, ok } from '../utils/http.js';
import { idParams, parseBody, parseParams, parseQuery } from '../validators/common.js';
import {
  assignSchema,
  certificateSchema,
  deliverySchema,
  disputeResolveSchema,
  failureSchema,
  feeRuleSchema,
  handoverSchema,
  historySchema,
  invoiceGenerateSchema,
  leaderboardSchema,
  locationSchema,
  manualPaymentSchema,
  paymentCreateSchema,
  paymentVerifySchema,
  pickupIdSchema,
  pickupListSchema,
  representativeCreateSchema,
  representativeStatusSchema,
  rewardAdjustSchema,
  rewardRuleSchema,
  trackingEventSchema,
  trackingStartSchema,
  trackingStopSchema,
  verifyQrSchema,
} from '../validators/pickup.validators.js';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent') });

const sendFile = (res: Response, buffer: Buffer, mime: string, filename?: string) => {
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  if (filename) res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  return res.send(buffer);
};

export function pickupController(reps: RepresentativeService, pickups: PickupService, tracking: TrackingService) {
  return {
    async listReps(req: Request, res: Response) {
      return ok(res, await reps.list(requireAuth(req)));
    },
    async createRep(req: Request, res: Response) {
      return created(res, await reps.create(requireAuth(req), parseBody(representativeCreateSchema, req), actorFrom(req)));
    },
    async setRepStatus(req: Request, res: Response) {
      await reps.setStatus(requireAuth(req), parseParams(idParams, req).id, parseBody(representativeStatusSchema, req).status, actorFrom(req));
      return noContent(res);
    },
    async uploadRepPhoto(req: Request, res: Response) {
      if (!req.file) throw badRequest('A photo is required (multipart field "file").', undefined, 'FILE_REQUIRED');
      await reps.uploadPhoto(requireAuth(req), parseParams(idParams, req).id, req.file.buffer, actorFrom(req));
      return noContent(res);
    },
    async repPhoto(req: Request, res: Response) {
      const photo = await reps.readPhoto(requireAuth(req), parseParams(idParams, req).id);
      return sendFile(res, photo.buffer, photo.mime);
    },

    async assign(req: Request, res: Response) {
      return created(res, await pickups.assign(requireAuth(req), parseBody(assignSchema, req), actorFrom(req)));
    },
    async list(req: Request, res: Response) {
      return ok(res, await pickups.list(requireAuth(req), parseQuery(pickupListSchema, req)));
    },
    async get(req: Request, res: Response) {
      return ok(res, await pickups.get(requireAuth(req), parseParams(idParams, req).id));
    },
    async generatePass(req: Request, res: Response) {
      return ok(res, await pickups.generatePass(requireAuth(req), parseBody(pickupIdSchema, req).pickupId, actorFrom(req)));
    },
    async verifyQr(req: Request, res: Response) {
      return ok(res, await pickups.verifyQr(requireAuth(req), parseBody(verifyQrSchema, req).token, meta(req)));
    },
    async confirmIdentity(req: Request, res: Response) {
      return ok(res, await pickups.confirmIdentity(requireAuth(req), parseBody(pickupIdSchema, req).pickupId, meta(req)));
    },
    async confirmHandover(req: Request, res: Response) {
      const { pickupId, quantity, notes } = parseBody(handoverSchema, req);
      return ok(res, await pickups.confirmHandover(requireAuth(req), pickupId, quantity, notes, actorFrom(req)));
    },
    async reportFailure(req: Request, res: Response) {
      return ok(res, await pickups.reportFailure(requireAuth(req), parseParams(idParams, req).id, parseBody(failureSchema, req).reason, actorFrom(req)));
    },
    async confirmDelivery(req: Request, res: Response) {
      return ok(res, await pickups.confirmDelivery(requireAuth(req), parseParams(idParams, req).id, parseBody(deliverySchema, req), actorFrom(req)));
    },
    async disputes(req: Request, res: Response) {
      const q = parseQuery(z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED']).optional() }), req);
      return ok(res, await pickups.disputes(requireAuth(req), q.status));
    },
    async resolveDispute(req: Request, res: Response) {
      await pickups.resolveDispute(parseParams(idParams, req).id, parseBody(disputeResolveSchema, req), actorFrom(req));
      return noContent(res);
    },
    async verificationLog(_req: Request, res: Response) {
      return ok(res, await pickups.verificationLog());
    },

    async startTracking(req: Request, res: Response) {
      return created(res, await tracking.start(requireAuth(req), parseBody(trackingStartSchema, req), actorFrom(req)));
    },
    async location(req: Request, res: Response) {
      const b = parseBody(locationSchema, req);
      return ok(res, await tracking.recordLocation(requireAuth(req), { sessionId: b.sessionId, location: { lat: b.lat, lng: b.lng }, accuracyM: b.accuracyM, heading: b.heading, speedMps: b.speedMps, recordedAt: b.recordedAt }));
    },
    async getTracking(req: Request, res: Response) {
      const { sessionId } = parseParams(z.object({ sessionId: z.uuid() }), req);
      return ok(res, await tracking.getSession(requireAuth(req), sessionId, actorFrom(req)));
    },
    async trackingPath(req: Request, res: Response) {
      const { sessionId } = parseParams(z.object({ sessionId: z.uuid() }), req);
      return ok(res, await tracking.path(requireAuth(req), sessionId, actorFrom(req)));
    },
    async stopTracking(req: Request, res: Response) {
      const { sessionId, reason } = parseBody(trackingStopSchema, req);
      return ok(res, await tracking.stop(requireAuth(req), sessionId, reason ?? 'stopped by user', actorFrom(req)));
    },
    async trackingEvent(req: Request, res: Response) {
      const b = parseBody(trackingEventSchema, req);
      return ok(res, await tracking.recordEvent(requireAuth(req), { sessionId: b.sessionId, pickupId: b.pickupId }, b.type, b.detail));
    },
    async confirmDeliveryFromTracking(req: Request, res: Response) {
      const { sessionId } = parseParams(z.object({ sessionId: z.uuid() }), req);
      const auth = requireAuth(req);
      const session = await tracking.getSession(auth, sessionId, actorFrom(req));
      return ok(res, await pickups.confirmDelivery(auth, session.pickupId, parseBody(deliverySchema, req), actorFrom(req)));
    },
    async activeTracking(_req: Request, res: Response) {
      return ok(res, await tracking.activeSessions());
    },
  };
}

export function rewardBillingController(rewards: RewardService, billing: BillingService) {
  return {
    async balance(req: Request, res: Response) {
      return ok(res, await rewards.balance(requireAuth(req)));
    },
    async history(req: Request, res: Response) {
      const q = parseQuery(historySchema, req);
      const r = await rewards.history(requireAuth(req), q.page, q.pageSize);
      return ok(res, r.items, { page: q.page, pageSize: q.pageSize, total: r.total });
    },
    async leaderboard(req: Request, res: Response) {
      return ok(res, await rewards.leaderboard(requireAuth(req), parseQuery(leaderboardSchema, req).month));
    },
    async certificates(req: Request, res: Response) {
      return ok(res, await rewards.certificates(requireAuth(req)));
    },
    async issueCertificate(req: Request, res: Response) {
      const { periodStart, periodEnd } = parseBody(certificateSchema, req);
      return created(res, await rewards.issueCertificate(requireAuth(req), periodStart, periodEnd, actorFrom(req)));
    },
    async certificatePdf(req: Request, res: Response) {
      const id = parseParams(idParams, req).id;
      return sendFile(res, await rewards.certificatePdf(requireAuth(req), id), 'application/pdf', `foodbridge-certificate-${id.slice(0, 8)}.pdf`);
    },
    async rewardRules(_req: Request, res: Response) {
      return ok(res, await rewards.listRules());
    },
    async upsertRewardRule(req: Request, res: Response) {
      return created(res, await rewards.upsertRule(parseBody(rewardRuleSchema, req), actorFrom(req)));
    },
    async deactivateRewardRule(req: Request, res: Response) {
      await rewards.deactivateRule(parseParams(idParams, req).id, actorFrom(req));
      return noContent(res);
    },
    async adjustRewards(req: Request, res: Response) {
      const b = parseBody(rewardAdjustSchema, req);
      return created(res, await rewards.adjust(b.donorId, b.points, b.reason, actorFrom(req)));
    },

    async billingSummary(req: Request, res: Response) {
      return ok(res, await billing.summary(requireAuth(req)));
    },
    async billingHistory(req: Request, res: Response) {
      const q = parseQuery(historySchema, req);
      const r = await billing.history(requireAuth(req), q.page, q.pageSize);
      return ok(res, r.items, { page: q.page, pageSize: q.pageSize, total: r.total });
    },
    async invoices(req: Request, res: Response) {
      return ok(res, await billing.invoices(requireAuth(req)));
    },
    async invoicePdf(req: Request, res: Response) {
      const pdf = await billing.invoicePdf(requireAuth(req), parseParams(idParams, req).id);
      return sendFile(res, pdf.buffer, 'application/pdf', `${pdf.number}.pdf`);
    },
    async createPayment(req: Request, res: Response) {
      return created(res, await billing.createPayment(requireAuth(req), parseBody(paymentCreateSchema, req).invoiceId, actorFrom(req)));
    },
    async verifyPayment(req: Request, res: Response) {
      return ok(res, await billing.verifyCheckout(requireAuth(req), parseBody(paymentVerifySchema, req), actorFrom(req)));
    },
    async payments(req: Request, res: Response) {
      return ok(res, await billing.payments(requireAuth(req)));
    },
    async razorpayWebhook(req: Request, res: Response) {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      return ok(res, await billing.handleWebhook(raw, req.header('x-razorpay-signature'), req.header('x-razorpay-event-id')));
    },
    async generateInvoices(req: Request, res: Response) {
      const { periodStart, periodEnd } = parseBody(invoiceGenerateSchema, req);
      return created(res, await billing.generateInvoices(periodStart, periodEnd, actorFrom(req)));
    },
    async manualPayment(req: Request, res: Response) {
      const b = parseBody(manualPaymentSchema, req);
      return created(res, await billing.recordManualPayment(b.invoiceId, b.amount, b.reference, actorFrom(req)));
    },
    async feeRules(_req: Request, res: Response) {
      return ok(res, await billing.feeRules());
    },
    async setFeeRule(req: Request, res: Response) {
      const b = parseBody(feeRuleSchema, req);
      return created(res, await billing.setFeeRule(b.unit, b.amountPerUnit, b.description, actorFrom(req)));
    },
  };
}
