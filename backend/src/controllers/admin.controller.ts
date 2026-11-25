import type { Request, Response } from 'express';
import { z } from 'zod';
import { actorFrom } from '../middleware/request-context.js';
import type { AdminService } from '../services/admin.service.js';
import type { SettingsService } from '../services/settings.service.js';
import type { VerificationService } from '../services/verification.service.js';
import { noContent, ok } from '../utils/http.js';
import { idParams, pagination, parseBody, parseParams, parseQuery } from '../validators/common.js';
import {
  applicationsQuerySchema,
  documentReviewSchema,
  orgParams,
  userListSchema,
  userStatusSchema,
  verificationDecisionSchema,
} from '../validators/profile.validators.js';

const auditQuery = pagination.extend({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
});

export function adminController(admin: AdminService, verification: VerificationService, settings: SettingsService) {
  return {
    async applications(req: Request, res: Response) {
      return ok(res, await verification.listApplications(parseQuery(applicationsQuerySchema, req)));
    },
    async organisationDocuments(req: Request, res: Response) {
      const { type, id } = parseParams(orgParams, req);
      return ok(res, await verification.listOrganisationDocuments(type, id));
    },
    async decide(req: Request, res: Response) {
      const { type, id } = parseParams(orgParams, req);
      const { status, notes } = parseBody(verificationDecisionSchema, req);
      await verification.decide(type, id, status, notes, actorFrom(req));
      return noContent(res);
    },
    async reviewDocument(req: Request, res: Response) {
      const { status, notes } = parseBody(documentReviewSchema, req);
      await verification.reviewDocument(parseParams(idParams, req).id, status, notes, actorFrom(req));
      return noContent(res);
    },
    async users(req: Request, res: Response) {
      const q = parseQuery(userListSchema, req);
      const result = await verification.listUsers(q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total });
    },
    async setUserStatus(req: Request, res: Response) {
      const { status, reason } = parseBody(userStatusSchema, req);
      await verification.setUserStatus(parseParams(idParams, req).id, status, reason, actorFrom(req));
      return noContent(res);
    },
    async settings(_req: Request, res: Response) {
      return ok(res, await settings.list());
    },
    async updateSetting(req: Request, res: Response) {
      const { key } = parseParams(z.object({ key: z.string().max(80) }), req);
      const { value } = parseBody(z.object({ value: z.unknown() }), req);
      return ok(res, { key, value: await settings.update(key, value, actorFrom(req)) });
    },
    async auditLogs(req: Request, res: Response) {
      const q = parseQuery(auditQuery, req);
      const result = await admin.auditLogs(q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total });
    },
    async jobs(req: Request, res: Response) {
      const q = parseQuery(pagination.extend({ status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD']).optional() }), req);
      return ok(res, await admin.jobs(q));
    },
    async retryJob(req: Request, res: Response) {
      const { id } = parseParams(z.object({ id: z.coerce.number().int().positive() }), req);
      await admin.retryJob(id, actorFrom(req));
      return noContent(res);
    },
    async notificationDeliveries(req: Request, res: Response) {
      const q = parseQuery(pagination.extend({ status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional() }), req);
      return ok(res, await admin.notificationDeliveries(q));
    },
  };
}
