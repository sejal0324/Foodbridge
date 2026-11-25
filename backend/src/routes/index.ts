import { Router } from 'express';
import multer from 'multer';
import type { AppContext, Services } from '../container.js';
import { adminController } from '../controllers/admin.controller.js';
import { authController } from '../controllers/auth.controller.js';
import { assistanceController, donationController, matchingController } from '../controllers/donation.controller.js';
import { geoController } from '../controllers/geo.controller.js';
import { intelligenceController } from '../controllers/intelligence.controller.js';
import { pickupController, rewardBillingController } from '../controllers/pickup.controller.js';
import { profileController } from '../controllers/profile.controller.js';
import { authenticate, requireAdmin, requireApprovedDonor, requireApprovedNgo, requireNgoMember, requireRole } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { createLimiter } from '../middleware/rate-limit.js';
import { healthRouter } from './health.routes.js';

const MINUTE = 60_000;

/** Builds the complete /api router. Every route declares its authentication and role requirements here. */
export function buildApiRouter(ctx: AppContext, s: Services): Router {
  const api = Router();
  const limit = (windowMs: number, max: number, key?: Parameters<typeof createLimiter>[1]['key']) =>
    createLimiter(ctx.config.rateLimitEnabled, { windowMs, limit: max, key });
  const authn = authenticate(s.auth);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });

  api.use('/health', healthRouter(ctx));

  // --- Authentication -------------------------------------------------------
  const auth = authController(s.auth, s.profiles, ctx.config);
  const loginKey = (req: { body?: { email?: unknown } }) => (typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : undefined);
  api.post('/auth/register', limit(60 * MINUTE, 20), auth.register);
  api.post('/auth/login', limit(15 * MINUTE, 10, loginKey), auth.login);
  api.post('/auth/refresh', limit(15 * MINUTE, 60), auth.refresh);
  // Logout works with an access token, or with only the refresh cookie when the access token has expired.
  api.post('/auth/logout', (req, res, next) => (req.header('authorization') ? authn(req, res, next) : next()), auth.logout);
  api.get('/auth/me', authn, auth.me);
  api.post('/auth/accept-invite', limit(15 * MINUTE, 10), auth.acceptInvite);
  api.post('/auth/password-reset/request', limit(60 * MINUTE, 5, loginKey), auth.requestPasswordReset);
  api.post('/auth/password-reset/confirm', limit(15 * MINUTE, 10), auth.resetPassword);
  api.post('/auth/change-password', authn, limit(15 * MINUTE, 10), auth.changePassword);

  // --- Profiles, documents, notifications -----------------------------------
  const profile = profileController(s.profiles, s.verification, s.notifications);
  api.get('/food-categories', profile.foodCategories);
  // India-wide location search (public: needed on the registration form). Rate-limited per IP.
  const geo = geoController(ctx.geocoding);
  api.get('/geo/search', limit(MINUTE, 30), geo.search);
  api.get('/geo/reverse', limit(MINUTE, 30), geo.reverse);
  api.get('/geo/states', geo.states);
  api.get('/donors/me', authn, requireRole('DONOR'), profile.getDonor);
  api.patch('/donors/me', authn, requireRole('DONOR'), profile.updateDonor);
  api.put('/donors/me/availability', authn, requireRole('DONOR'), profile.setAvailability);
  api.put('/donors/me/categories', authn, requireRole('DONOR'), profile.setDonorCategories);
  api.get('/ngos/me', authn, requireRole('NGO'), profile.getNgo);
  api.patch('/ngos/me', authn, requireRole('NGO'), profile.updateNgo);
  api.put('/ngos/me/food-preferences', authn, requireRole('NGO'), profile.setNgoPreferences);
  api.post('/verification-documents', authn, requireRole('DONOR', 'NGO'), limit(60 * MINUTE, 30), upload.single('file'), profile.uploadDocument);
  api.get('/verification-documents', authn, requireRole('DONOR', 'NGO'), profile.listDocuments);
  api.get('/verification-documents/:id/file', authn, profile.downloadDocument);
  api.get('/notifications', authn, profile.listNotifications);
  api.post('/notifications/read-all', authn, profile.markAllNotificationsRead);
  api.patch('/notifications/:id/read', authn, profile.markNotificationRead);
  api.get('/notifications/preferences', authn, profile.getNotificationPreferences);
  api.put('/notifications/preferences', authn, profile.updateNotificationPreferences);

  // --- Workflow A: donations, NGO requests, allocations ----------------------
  const donation = donationController(s.donations, s.allocations, s.fees);
  const ngoMember = [authn, requireNgoMember];
  api.post('/donations', authn, requireApprovedDonor, idempotent(ctx.db, 'POST /donations'), donation.create);
  api.get('/donations', authn, donation.list);
  api.get('/donations/:id', authn, donation.get);
  api.patch('/donations/:id', authn, requireApprovedDonor, donation.update);
  api.post('/donations/:id/cancel', authn, requireRole('DONOR', 'ADMIN'), donation.cancel);
  api.post('/donations/:id/requests', authn, requireApprovedNgo, idempotent(ctx.db, 'POST /donations/:id/requests'), donation.createRequest);
  api.post('/donations/:id/approve-batch', authn, requireApprovedDonor, donation.approveBatch);
  api.get('/requests', authn, donation.listRequests);
  api.patch('/requests/:id/approve', authn, requireApprovedDonor, donation.approveRequest);
  api.patch('/requests/:id/reject', authn, requireApprovedDonor, donation.rejectRequest);
  api.patch('/requests/:id/withdraw', authn, requireApprovedNgo, donation.withdrawRequest);
  api.get('/allocations', authn, donation.listAllocations);
  api.post('/allocations/:id/cancel', authn, donation.cancelAllocation);
  api.get('/billing/fee-estimate', authn, donation.feeEstimate);

  // --- Workflow B: NGO assistance requests and donor offers -----------------
  const assistance = assistanceController(s.assistance);
  api.post('/assistance-requests', authn, requireApprovedNgo, idempotent(ctx.db, 'POST /assistance-requests'), assistance.create);
  api.get('/assistance-requests', authn, assistance.list);
  api.get('/assistance-requests/:id', authn, assistance.get);
  api.patch('/assistance-requests/:id', authn, requireApprovedNgo, assistance.update);
  api.post('/assistance-requests/:id/cancel', authn, requireRole('NGO', 'ADMIN'), assistance.cancel);
  api.post('/assistance-requests/:id/offers', authn, requireApprovedDonor, idempotent(ctx.db, 'POST /assistance-requests/:id/offers'), assistance.createOffer);
  api.get('/assistance-requests/:id/offers', authn, assistance.listOffers);
  api.post('/assistance-requests/:id/respond', authn, requireApprovedDonor, assistance.respond);
  api.get('/offers/mine', authn, requireApprovedDonor, assistance.myOffers);
  api.patch('/offers/:id/accept', authn, requireApprovedNgo, assistance.acceptOffer);
  api.patch('/offers/:id/reject', authn, requireApprovedNgo, assistance.rejectOffer);
  api.patch('/offers/:id/confirm', authn, requireApprovedDonor, assistance.confirmOffer);
  api.post('/offers/:id/cancel', authn, requireApprovedDonor, assistance.cancelOffer);

  // --- Matching -------------------------------------------------------------
  const match = matchingController(s.matching);
  api.get('/matching/ngos', authn, requireRole('DONOR', 'ADMIN'), match.ngosForDonation);
  api.get('/matching/donors', authn, requireRole('NGO', 'ADMIN'), match.donorsForRequest);
  api.get('/matching/donations', ...ngoMember, match.donationsForNgo);
  api.get('/matching/assistance-requests', authn, requireApprovedDonor, match.requestsForDonor);
  api.post('/matching/refresh', authn, requireRole('DONOR', 'NGO', 'ADMIN'), limit(MINUTE, 6), match.refresh);
  api.post('/matching/allocate', authn, requireRole('DONOR', 'NGO'), limit(MINUTE, 10), match.allocate);

  // --- Representatives, pickups, verification, handover ---------------------
  const pickup = pickupController(s.representatives, s.pickups, s.tracking);
  const verifyLimit = limit(15 * MINUTE, 30, (req) => req.auth?.userId);
  api.get('/ngos/me/representatives', authn, requireApprovedNgo, pickup.listReps);
  api.post('/ngos/me/representatives', authn, requireApprovedNgo, pickup.createRep);
  api.patch('/ngos/me/representatives/:id', authn, requireApprovedNgo, pickup.setRepStatus);
  api.put('/ngos/me/representatives/:id/photo', authn, requireApprovedNgo, upload.single('file'), pickup.uploadRepPhoto);
  api.get('/representatives/:id/photo', authn, pickup.repPhoto);
  api.post('/pickups/assign', authn, requireApprovedNgo, pickup.assign);
  api.get('/pickups', authn, pickup.list);
  api.get('/pickups/:id', authn, pickup.get);
  api.post('/pickups/generate-pass', ...ngoMember, limit(15 * MINUTE, 20, (req) => req.auth?.userId), pickup.generatePass);
  api.post('/pickups/verify-qr', authn, requireApprovedDonor, verifyLimit, pickup.verifyQr);
  api.post('/pickups/confirm-identity', authn, requireApprovedDonor, pickup.confirmIdentity);
  api.post('/pickups/confirm-handover', authn, requireRole('DONOR', 'NGO'), pickup.confirmHandover);
  api.post('/pickups/:id/report-failure', authn, requireRole('DONOR', 'NGO'), pickup.reportFailure);
  api.post('/pickups/:id/confirm-delivery', ...ngoMember, pickup.confirmDelivery);
  api.get('/disputes', authn, pickup.disputes);

  // --- LiveTrack ---------------------------------------------------------------
  api.post('/tracking/start', ...ngoMember, pickup.startTracking);
  api.post('/tracking/location', ...ngoMember, limit(MINUTE, 120, (req) => req.auth?.userId), pickup.location);
  api.post('/tracking/stop', ...ngoMember, pickup.stopTracking);
  api.post('/tracking/events', ...ngoMember, pickup.trackingEvent);
  api.get('/tracking/:sessionId', authn, pickup.getTracking);
  api.get('/tracking/:sessionId/path', authn, pickup.trackingPath);
  api.post('/tracking/:sessionId/confirm-delivery', ...ngoMember, pickup.confirmDeliveryFromTracking);

  // --- Rewards (donors) and billing (NGOs) -------------------------------------
  const rb = rewardBillingController(s.rewards, s.billing);
  api.get('/rewards/balance', authn, requireRole('DONOR'), rb.balance);
  api.get('/rewards/history', authn, requireRole('DONOR'), rb.history);
  api.get('/rewards/leaderboard', authn, rb.leaderboard);
  api.get('/rewards/certificates', authn, requireRole('DONOR'), rb.certificates);
  api.post('/rewards/certificates', authn, requireApprovedDonor, rb.issueCertificate);
  api.get('/rewards/certificates/:id/pdf', authn, requireRole('DONOR'), rb.certificatePdf);
  api.get('/billing/summary', authn, requireRole('NGO'), rb.billingSummary);
  api.get('/billing/history', authn, requireRole('NGO', 'ADMIN'), rb.billingHistory);
  api.get('/billing/invoices', authn, requireRole('NGO', 'ADMIN'), rb.invoices);
  api.get('/billing/invoices/:id/pdf', authn, requireRole('NGO', 'ADMIN'), rb.invoicePdf);
  api.get('/billing/payments', authn, requireRole('NGO', 'ADMIN'), rb.payments);
  api.post('/billing/payments', authn, requireApprovedNgo, limit(15 * MINUTE, 20), rb.createPayment);
  api.post('/billing/payments/verify', authn, requireApprovedNgo, rb.verifyPayment);
  // Webhook: no user session; authenticated by HMAC signature over the raw body.
  api.post('/billing/webhooks/razorpay', limit(MINUTE, 120), rb.razorpayWebhook);

  // --- Prediction, analytics, planning, assistant ----------------------------
  const intel = intelligenceController(s.predictions, s.analytics, s.planning, s.assistant, s.assistance);
  api.post('/donors/me/metrics', authn, requireApprovedDonor, intel.recordMetric);
  api.get('/donors/me/metrics', authn, requireRole('DONOR'), intel.listMetrics);
  api.get('/predictions/surplus', authn, requireApprovedDonor, limit(MINUTE, 20, (req) => req.auth?.userId), intel.forecast);
  api.get('/predictions/accuracy', authn, requireRole('DONOR'), intel.forecastAccuracy);
  api.get('/public/impact', limit(MINUTE, 60), intel.publicImpact);
  api.get('/analytics/donor', authn, requireRole('DONOR'), intel.donorAnalytics);
  api.get('/analytics/ngo', ...ngoMember, intel.ngoAnalytics);
  api.get('/analytics/admin', authn, requireAdmin, intel.adminAnalytics);
  api.get('/analytics/insights', authn, limit(MINUTE, 10, (req) => req.auth?.userId), intel.insights);
  api.post('/collection-plans', authn, requireApprovedNgo, limit(MINUTE, 10), intel.createPlan);
  api.get('/collection-plans', authn, requireApprovedNgo, intel.listPlans);
  api.get('/collection-plans/:id', ...ngoMember, intel.getPlan);
  api.patch('/collection-plans/:id/status', authn, requireApprovedNgo, intel.setPlanStatus);
  api.post('/ai/chat', authn, limit(MINUTE, 20, (req) => req.auth?.userId), intel.chat);
  api.get('/ai/suggestions', authn, intel.suggestions);
  api.get('/ai/conversations', authn, intel.conversations);
  api.get('/ai/conversations/:id/messages', authn, intel.messages);
  api.post('/ai/actions/:id/confirm', authn, intel.confirmAction);
  api.post('/ai/actions/:id/cancel', authn, intel.cancelAction);

  // --- Admin ----------------------------------------------------------------
  const admin = adminController(s.admin, s.verification, s.settings);
  api.get('/admin/ai/performance', authn, requireAdmin, intel.aiPerformance);
  const adminOnly = [authn, requireAdmin];
  api.get('/admin/verifications', ...adminOnly, admin.applications);
  api.get('/admin/organizations/:type/:id/documents', ...adminOnly, admin.organisationDocuments);
  api.patch('/admin/organizations/:type/:id/verification', ...adminOnly, admin.decide);
  api.patch('/admin/verification-documents/:id', ...adminOnly, admin.reviewDocument);
  api.get('/admin/users', ...adminOnly, admin.users);
  api.patch('/admin/users/:id/status', ...adminOnly, admin.setUserStatus);
  api.get('/admin/settings', ...adminOnly, admin.settings);
  api.put('/admin/settings/:key', ...adminOnly, admin.updateSetting);
  api.get('/admin/audit-logs', ...adminOnly, admin.auditLogs);
  api.get('/admin/jobs', ...adminOnly, admin.jobs);
  api.post('/admin/jobs/:id/retry', ...adminOnly, admin.retryJob);
  api.get('/admin/notification-deliveries', ...adminOnly, admin.notificationDeliveries);
  api.get('/admin/verification-logs', ...adminOnly, pickup.verificationLog);
  api.patch('/admin/disputes/:id/resolve', ...adminOnly, pickup.resolveDispute);
  api.get('/admin/tracking/active', ...adminOnly, pickup.activeTracking);
  api.get('/admin/reward-rules', ...adminOnly, rb.rewardRules);
  api.post('/admin/reward-rules', ...adminOnly, rb.upsertRewardRule);
  api.delete('/admin/reward-rules/:id', ...adminOnly, rb.deactivateRewardRule);
  api.post('/admin/rewards/adjust', ...adminOnly, rb.adjustRewards);
  api.get('/admin/fee-rules', ...adminOnly, rb.feeRules);
  api.post('/admin/fee-rules', ...adminOnly, rb.setFeeRule);
  api.post('/admin/invoices/generate', ...adminOnly, rb.generateInvoices);
  api.post('/admin/payments/manual', ...adminOnly, rb.manualPayment);

  return api;
}
