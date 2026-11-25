import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFrom, requireAuth } from '../middleware/request-context.js';
import type { AnalyticsService } from '../services/analytics.service.js';
import type { AssistanceService } from '../services/assistance.service.js';
import type { AssistantService } from '../services/assistant.service.js';
import type { PlanningService } from '../services/planning.service.js';
import type { PredictionService } from '../services/prediction.service.js';
import { created, noContent, ok } from '../utils/http.js';
import { idParams, isoDate, isoDateTime, latLng, mealPeriod, optionalText, parseBody, parseParams, parseQuery } from '../validators/common.js';

const metricSchema = z
  .object({
    date: isoDate,
    mealPeriod,
    preparedQty: z.number().int().min(0).max(100000),
    soldQty: z.number().int().min(0).max(100000),
    surplusQty: z.number().int().min(0).max(100000),
    isHoliday: z.boolean().optional(),
    specialEvent: optionalText(120),
  })
  .strict()
  .refine((m) => m.soldQty <= m.preparedQty && m.surplusQty <= m.preparedQty, 'sold and surplus cannot exceed prepared');

const planSchema = z
  .object({
    planDate: isoDate,
    startTime: isoDateTime,
    vehicleCapacity: z.number().int().positive().max(100000).optional(),
    representativeId: z.uuid().optional(),
    start: z.object({ location: latLng, address: optionalText(300) }).optional(),
    end: z.object({ location: latLng, address: optionalText(300) }).optional(),
    allocationIds: z.array(z.uuid()).min(1).max(25),
  })
  .strict();

const chatSchema = z.object({ message: z.string().trim().min(1).max(2000), conversationId: z.uuid().optional(), intent: z.string().regex(/^[a-z_]{3,40}$/).optional() }).strict();

export function intelligenceController(predictions: PredictionService, analytics: AnalyticsService, planning: PlanningService, assistant: AssistantService, assistance: AssistanceService) {
  return {
    async recordMetric(req: Request, res: Response) {
      return ok(res, await predictions.upsertMetric(requireAuth(req), parseBody(metricSchema, req), actorFrom(req)));
    },
    async listMetrics(req: Request, res: Response) {
      const { days } = parseQuery(z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }), req);
      return ok(res, await predictions.listMetrics(requireAuth(req), days));
    },
    async forecast(req: Request, res: Response) {
      const { date } = parseQuery(z.object({ date: isoDate.optional() }), req);
      return ok(res, await predictions.forecastForDonor(requireAuth(req), date));
    },
    async forecastAccuracy(req: Request, res: Response) {
      return ok(res, await predictions.accuracy(requireAuth(req)));
    },

    async publicImpact(_req: Request, res: Response) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return ok(res, await analytics.publicImpact());
    },
    async donorAnalytics(req: Request, res: Response) {
      return ok(res, await analytics.donor(requireAuth(req)));
    },
    async ngoAnalytics(req: Request, res: Response) {
      return ok(res, await analytics.ngo(requireAuth(req)));
    },
    async adminAnalytics(_req: Request, res: Response) {
      return ok(res, await analytics.admin());
    },
    async insights(req: Request, res: Response) {
      return ok(res, await analytics.insights(requireAuth(req)));
    },
    async aiPerformance(_req: Request, res: Response) {
      return ok(res, await analytics.aiPerformance());
    },

    async createPlan(req: Request, res: Response) {
      return created(res, await planning.create(requireAuth(req), parseBody(planSchema, req), actorFrom(req)));
    },
    async listPlans(req: Request, res: Response) {
      return ok(res, await planning.list(requireAuth(req)));
    },
    async getPlan(req: Request, res: Response) {
      return ok(res, await planning.get(requireAuth(req), parseParams(idParams, req).id));
    },
    async setPlanStatus(req: Request, res: Response) {
      const { status } = parseBody(z.object({ status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED']) }), req);
      return ok(res, await planning.setStatus(requireAuth(req), parseParams(idParams, req).id, status, actorFrom(req)));
    },

    async chat(req: Request, res: Response) {
      return ok(res, await assistant.chat(requireAuth(req), parseBody(chatSchema, req), req.requestId));
    },
    async suggestions(req: Request, res: Response) {
      return ok(res, assistant.suggestions(requireAuth(req).role));
    },
    async conversations(req: Request, res: Response) {
      return ok(res, await assistant.conversations(requireAuth(req)));
    },
    async messages(req: Request, res: Response) {
      return ok(res, await assistant.messages(requireAuth(req), parseParams(idParams, req).id));
    },
    async confirmAction(req: Request, res: Response) {
      const { id } = parseParams(z.object({ id: z.coerce.number().int().positive() }), req);
      return created(res, await assistant.confirmAction(requireAuth(req), id, actorFrom(req), { assistance }));
    },
    async cancelAction(req: Request, res: Response) {
      const { id } = parseParams(z.object({ id: z.coerce.number().int().positive() }), req);
      await assistant.cancelAction(requireAuth(req), id);
      return noContent(res);
    },
  };
}
