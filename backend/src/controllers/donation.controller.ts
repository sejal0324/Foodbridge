import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFrom, requireAuth } from '../middleware/request-context.js';
import type { AllocationService } from '../services/allocation.service.js';
import type { AssistanceService } from '../services/assistance.service.js';
import type { DonationService } from '../services/donation.service.js';
import type { FeeService } from '../services/fee.service.js';
import type { MatchingService } from '../services/matching.service.js';
import { badRequest } from '../utils/errors.js';
import { created, noContent, ok } from '../utils/http.js';
import { idParams, pagination, parseBody, parseParams, parseQuery, quantity } from '../validators/common.js';
import {
  assistanceCreateSchema,
  assistanceListSchema,
  assistanceUpdateSchema,
  cancelSchema,
  donationCreateSchema,
  donationListSchema,
  donationRequestCreateSchema,
  donationUpdateSchema,
  feeEstimateSchema,
  offerAcceptSchema,
  offerConfirmSchema,
  offerCreateSchema,
  offerRespondSchema,
  requestApproveSchema,
  requestListSchema,
  requestRejectSchema,
} from '../validators/donation.validators.js';

export function donationController(donations: DonationService, allocations: AllocationService, fees: FeeService) {
  return {
    async create(req: Request, res: Response) {
      return created(res, await donations.create(requireAuth(req), parseBody(donationCreateSchema, req), actorFrom(req)));
    },
    async list(req: Request, res: Response) {
      const q = parseQuery(donationListSchema, req);
      const result = await donations.list(requireAuth(req), q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total });
    },
    async get(req: Request, res: Response) {
      return ok(res, await donations.get(requireAuth(req), parseParams(idParams, req).id));
    },
    async update(req: Request, res: Response) {
      return ok(res, await donations.update(requireAuth(req), parseParams(idParams, req).id, parseBody(donationUpdateSchema, req), actorFrom(req)));
    },
    async cancel(req: Request, res: Response) {
      const { reason } = parseBody(cancelSchema, req);
      return ok(res, await donations.cancel(requireAuth(req), parseParams(idParams, req).id, reason, actorFrom(req)));
    },
    async createRequest(req: Request, res: Response) {
      return created(res, await donations.createRequest(requireAuth(req), parseParams(idParams, req).id, parseBody(donationRequestCreateSchema, req), actorFrom(req)));
    },
    async approveBatch(req: Request, res: Response) {
      const { allocations: items } = parseBody(z.object({ allocations: z.array(z.object({ requestId: z.uuid(), quantity })).min(1).max(50) }), req);
      return ok(res, await donations.approveBatch(requireAuth(req), parseParams(idParams, req).id, items, actorFrom(req)));
    },
    async listRequests(req: Request, res: Response) {
      const q = parseQuery(requestListSchema, req);
      const result = await donations.listRequests(requireAuth(req), q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total });
    },
    async approveRequest(req: Request, res: Response) {
      const { quantity: q } = parseBody(requestApproveSchema, req);
      return ok(res, await donations.approveRequest(requireAuth(req), parseParams(idParams, req).id, q, actorFrom(req)));
    },
    async rejectRequest(req: Request, res: Response) {
      const { reason } = parseBody(requestRejectSchema, req);
      await donations.rejectRequest(requireAuth(req), parseParams(idParams, req).id, reason, actorFrom(req));
      return noContent(res);
    },
    async withdrawRequest(req: Request, res: Response) {
      await donations.withdrawRequest(requireAuth(req), parseParams(idParams, req).id, actorFrom(req));
      return noContent(res);
    },
    async listAllocations(req: Request, res: Response) {
      const q = parseQuery(pagination.extend({ status: z.string().regex(/^[A-Z_]+$/).optional() }), req);
      const result = await allocations.list(requireAuth(req), q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total });
    },
    async cancelAllocation(req: Request, res: Response) {
      const { reason } = parseBody(cancelSchema, req);
      await allocations.cancel(requireAuth(req), parseParams(idParams, req).id, reason, actorFrom(req));
      return noContent(res);
    },
    async feeEstimate(req: Request, res: Response) {
      const q = parseQuery(feeEstimateSchema, req);
      return ok(res, await fees.estimate(q.unit, q.quantity));
    },
  };
}

export function assistanceController(assistance: AssistanceService) {
  return {
    async create(req: Request, res: Response) {
      return created(res, await assistance.create(requireAuth(req), parseBody(assistanceCreateSchema, req), actorFrom(req)));
    },
    async list(req: Request, res: Response) {
      const q = parseQuery(assistanceListSchema, req);
      const result = await assistance.list(requireAuth(req), q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total });
    },
    async get(req: Request, res: Response) {
      return ok(res, await assistance.get(requireAuth(req), parseParams(idParams, req).id));
    },
    async update(req: Request, res: Response) {
      return ok(res, await assistance.update(requireAuth(req), parseParams(idParams, req).id, parseBody(assistanceUpdateSchema, req), actorFrom(req)));
    },
    async cancel(req: Request, res: Response) {
      const { reason } = parseBody(cancelSchema, req);
      return ok(res, await assistance.cancel(requireAuth(req), parseParams(idParams, req).id, reason, actorFrom(req)));
    },
    async createOffer(req: Request, res: Response) {
      return created(res, await assistance.createOffer(requireAuth(req), parseParams(idParams, req).id, parseBody(offerCreateSchema, req), actorFrom(req)));
    },
    async listOffers(req: Request, res: Response) {
      return ok(res, await assistance.listOffers(requireAuth(req), parseParams(idParams, req).id));
    },
    async respond(req: Request, res: Response) {
      const { response } = parseBody(offerRespondSchema, req);
      return ok(res, await assistance.respond(requireAuth(req), parseParams(idParams, req).id, response, actorFrom(req)));
    },
    async myOffers(req: Request, res: Response) {
      return ok(res, await assistance.myOffers(requireAuth(req)));
    },
    async acceptOffer(req: Request, res: Response) {
      const { quantity: q } = parseBody(offerAcceptSchema, req);
      return ok(res, await assistance.acceptOffer(requireAuth(req), parseParams(idParams, req).id, q, actorFrom(req)));
    },
    async rejectOffer(req: Request, res: Response) {
      const { reason } = parseBody(requestRejectSchema, req);
      await assistance.rejectOffer(requireAuth(req), parseParams(idParams, req).id, reason, actorFrom(req));
      return noContent(res);
    },
    async confirmOffer(req: Request, res: Response) {
      return ok(res, await assistance.confirmOffer(requireAuth(req), parseParams(idParams, req).id, parseBody(offerConfirmSchema, req), actorFrom(req)));
    },
    async cancelOffer(req: Request, res: Response) {
      const { reason } = parseBody(cancelSchema, req);
      await assistance.cancelOffer(requireAuth(req), parseParams(idParams, req).id, reason, actorFrom(req));
      return noContent(res);
    },
  };
}

export function matchingController(matching: MatchingService) {
  const idQuery = (key: string) => z.object({ [key]: z.uuid() });
  return {
    async ngosForDonation(req: Request, res: Response) {
      const q = parseQuery(idQuery('donationId'), req) as { donationId: string };
      return ok(res, await matching.recommendationsForDonation(requireAuth(req), q.donationId));
    },
    async donorsForRequest(req: Request, res: Response) {
      const q = parseQuery(idQuery('requestId'), req) as { requestId: string };
      return ok(res, await matching.recommendationsForRequest(requireAuth(req), q.requestId));
    },
    async donationsForNgo(req: Request, res: Response) {
      return ok(res, await matching.recommendedDonationsForNgo(requireAuth(req)));
    },
    async requestsForDonor(req: Request, res: Response) {
      return ok(res, await matching.recommendedRequestsForDonor(requireAuth(req)));
    },
    async refresh(req: Request, res: Response) {
      const body = parseBody(z.object({ donationId: z.uuid().optional(), requestId: z.uuid().optional() }), req);
      const auth = requireAuth(req);
      if (body.donationId) return ok(res, await matching.refreshDonation(auth, body.donationId));
      if (body.requestId) return ok(res, await matching.refreshRequest(auth, body.requestId));
      throw badRequest('donationId or requestId is required.');
    },
    async allocate(req: Request, res: Response) {
      const body = parseBody(z.object({ donationId: z.uuid().optional(), assistanceRequestId: z.uuid().optional() }), req);
      const auth = requireAuth(req);
      if (body.donationId) return ok(res, await matching.proposeDonationAllocation(auth, body.donationId));
      if (body.assistanceRequestId) return ok(res, await matching.proposeRequestAllocation(auth, body.assistanceRequestId));
      throw badRequest('donationId or assistanceRequestId is required.');
    },
  };
}
