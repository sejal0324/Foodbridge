import type { Request, Response } from 'express';
import { actorFrom, requireAuth } from '../middleware/request-context.js';
import type { NotificationService } from '../services/notification.service.js';
import type { ProfileService } from '../services/profile.service.js';
import type { VerificationService } from '../services/verification.service.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { created, noContent, ok } from '../utils/http.js';
import { idParams, parseBody, parseParams, parseQuery } from '../validators/common.js';
import {
  availabilitySchema,
  categoryIdsSchema,
  documentUploadSchema,
  donorUpdateSchema,
  ngoUpdateSchema,
  notificationListSchema,
  notificationPreferencesSchema,
} from '../validators/profile.validators.js';

export function profileController(profiles: ProfileService, verification: VerificationService, notifications: NotificationService) {
  return {
    async foodCategories(_req: Request, res: Response) {
      return ok(res, await profiles.listFoodCategories());
    },

    async getDonor(req: Request, res: Response) {
      const auth = requireAuth(req);
      if (!auth.donorId) throw forbidden();
      return ok(res, await profiles.getDonorProfile(auth.donorId));
    },
    async updateDonor(req: Request, res: Response) {
      return ok(res, await profiles.updateDonorProfile(requireAuth(req), parseBody(donorUpdateSchema, req), actorFrom(req)));
    },
    async setAvailability(req: Request, res: Response) {
      const { slots } = parseBody(availabilitySchema, req);
      return ok(res, await profiles.setDonorAvailability(requireAuth(req), slots, actorFrom(req)));
    },
    async setDonorCategories(req: Request, res: Response) {
      const { categoryIds } = parseBody(categoryIdsSchema, req);
      return ok(res, await profiles.setDonorCategories(requireAuth(req), categoryIds, actorFrom(req)));
    },

    async getNgo(req: Request, res: Response) {
      const auth = requireAuth(req);
      if (!auth.ngoId) throw forbidden();
      return ok(res, await profiles.getNgoProfile(auth.ngoId));
    },
    async updateNgo(req: Request, res: Response) {
      return ok(res, await profiles.updateNgoProfile(requireAuth(req), parseBody(ngoUpdateSchema, req), actorFrom(req)));
    },
    async setNgoPreferences(req: Request, res: Response) {
      const { categoryIds } = parseBody(categoryIdsSchema, req);
      return ok(res, await profiles.setNgoFoodPreferences(requireAuth(req), categoryIds, actorFrom(req)));
    },

    async uploadDocument(req: Request, res: Response) {
      const { documentType } = parseBody(documentUploadSchema, req);
      const file = req.file;
      if (!file) throw badRequest('A file is required (multipart field "file").', undefined, 'FILE_REQUIRED');
      return created(res, await verification.uploadDocument(requireAuth(req), documentType, file, actorFrom(req)));
    },
    async listDocuments(req: Request, res: Response) {
      return ok(res, await verification.listOwnDocuments(requireAuth(req)));
    },
    async downloadDocument(req: Request, res: Response) {
      const { id } = parseParams(idParams, req);
      const doc = await verification.readDocument(requireAuth(req), id);
      res.setHeader('Content-Type', doc.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(doc.buffer);
    },

    async listNotifications(req: Request, res: Response) {
      const q = parseQuery(notificationListSchema, req);
      const result = await notifications.list(requireAuth(req).userId, q);
      return ok(res, result.items, { page: q.page, pageSize: q.pageSize, total: result.total, unread: result.unread });
    },
    async markNotificationRead(req: Request, res: Response) {
      await notifications.markRead(requireAuth(req).userId, parseParams(idParams, req).id);
      return noContent(res);
    },
    async markAllNotificationsRead(req: Request, res: Response) {
      return ok(res, { updated: await notifications.markAllRead(requireAuth(req).userId) });
    },
    async getNotificationPreferences(req: Request, res: Response) {
      return ok(res, await notifications.getPreferences(requireAuth(req).userId));
    },
    async updateNotificationPreferences(req: Request, res: Response) {
      return ok(res, await notifications.updatePreferences(requireAuth(req).userId, parseBody(notificationPreferencesSchema, req)));
    },
  };
}
