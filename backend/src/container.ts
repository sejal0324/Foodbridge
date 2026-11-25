import type { AppConfig } from './config/env.js';
import { createLogger, type Logger } from './config/logger.js';
import { Database } from './db/database.js';
import { AiClient } from './integrations/ai-client.js';
import { createEmailProvider, type EmailProvider } from './integrations/email.js';
import { GeocodingClient } from './integrations/geocoding.js';
import { MapsClient } from './integrations/maps.js';
import { RazorpayGateway } from './integrations/razorpay.js';
import { LocalFileStorage } from './integrations/storage.js';
import { JobWorker } from './jobs/worker.js';
import { AdminService } from './services/admin.service.js';
import { AllocationService } from './services/allocation.service.js';
import { AnalyticsService } from './services/analytics.service.js';
import { AssistanceService, MATCH_REQUEST_JOB } from './services/assistance.service.js';
import { AssistantService } from './services/assistant.service.js';
import { AuthService } from './services/auth.service.js';
import { BillingService } from './services/billing.service.js';
import { DonationService, MATCH_DONATION_JOB } from './services/donation.service.js';
import { EXPIRY_JOB, ExpiryService } from './services/expiry.service.js';
import { FeeService } from './services/fee.service.js';
import { MaintenanceService } from './services/maintenance.service.js';
import { MatchingService } from './services/matching.service.js';
import { EMAIL_JOB, NotificationService } from './services/notification.service.js';
import { PickupService } from './services/pickup.service.js';
import { PlanningService } from './services/planning.service.js';
import { FORECAST_JOB, PredictionService } from './services/prediction.service.js';
import { ProfileService } from './services/profile.service.js';
import { RepresentativeService } from './services/representative.service.js';
import { RewardService } from './services/reward.service.js';
import { SettingsService } from './services/settings.service.js';
import { TokenService } from './services/token.service.js';
import { RETENTION_JOB, TrackingService } from './services/tracking.service.js';
import { VerificationService } from './services/verification.service.js';
import { RealtimeHub } from './sockets/realtime.js';

/** Infrastructure shared by all services. Tests replace integrations through `overrides`. */
export interface AppContext {
  config: AppConfig;
  logger: Logger;
  db: Database;
  realtime: RealtimeHub;
  email: EmailProvider;
  storage: LocalFileStorage;
  ai: AiClient;
  maps: MapsClient;
  geocoding: GeocodingClient;
  razorpay: RazorpayGateway;
}

export type ContextOverrides = Partial<Pick<AppContext, 'email' | 'logger' | 'storage' | 'ai' | 'maps' | 'geocoding' | 'razorpay'>>;

export function createContext(config: AppConfig, overrides: ContextOverrides = {}): AppContext {
  const logger = overrides.logger ?? createLogger(config.logLevel, config.env === 'development' && process.stdout.isTTY);
  return {
    config,
    logger,
    db: new Database(config.database.url, config.database.poolMax, logger),
    realtime: new RealtimeHub(),
    email: overrides.email ?? createEmailProvider(config.email, logger),
    storage: overrides.storage ?? new LocalFileStorage(config.uploadDir),
    ai: overrides.ai ?? new AiClient(config.ai, logger),
    maps: overrides.maps ?? new MapsClient(config.maps.serverApiKey, logger),
    geocoding: overrides.geocoding ?? new GeocodingClient(config.maps.serverApiKey, logger),
    razorpay: overrides.razorpay ?? new RazorpayGateway(config.razorpay),
  };
}

export function createServices(ctx: AppContext) {
  const { db, config, logger } = ctx;
  const settings = new SettingsService(db);
  const tokens = new TokenService(config.auth.accessSecret, config.auth.accessTtlSeconds);
  const notifications = new NotificationService(db, ctx.realtime, ctx.email, logger);
  const auth = new AuthService(db, config, tokens, notifications, ctx.email, logger);
  const profiles = new ProfileService(db, notifications);
  const verification = new VerificationService(db, ctx.storage, notifications);
  const admin = new AdminService(db);
  const fees = new FeeService(db, settings);
  const allocations = new AllocationService(db, notifications);
  const donations = new DonationService(db, settings, allocations, fees, notifications);
  const assistance = new AssistanceService(db, allocations, fees, notifications);
  const matching = new MatchingService(db, ctx.ai, settings, notifications, logger);
  const expiry = new ExpiryService(db, allocations, notifications, logger);
  const representatives = new RepresentativeService(db, config, auth, ctx.email, ctx.storage);
  const rewards = new RewardService(db, notifications);
  const billing = new BillingService(db, fees, settings, ctx.razorpay, notifications, logger);
  const pickups = new PickupService(db, settings, allocations, rewards, billing, notifications, ctx.realtime);
  const tracking = new TrackingService(db, config, settings, ctx.maps, ctx.realtime, logger);
  const predictions = new PredictionService(db, ctx.ai, logger);
  const analytics = new AnalyticsService(db, ctx.ai, settings, logger);
  const planning = new PlanningService(db, ctx.ai, ctx.maps);
  const maintenance = new MaintenanceService(db, logger);
  const assistant = new AssistantService(db, ctx.ai, settings, logger, {
    donations, assistance, matching, predictions, analytics, rewards, billing, pickups, planning, verification,
  });
  return {
    settings, tokens, notifications, auth, profiles, verification, admin, fees, allocations, donations, assistance, matching, expiry,
    representatives, rewards, billing, pickups, tracking, predictions, analytics, planning, assistant, maintenance,
  };
}

export type Services = ReturnType<typeof createServices>;

/** Registers every background job handler. */
export function registerJobs(worker: JobWorker, s: Services, retentionDays = 90): void {
  worker.register(EMAIL_JOB, (job) => s.notifications.deliverEmail(job));
  worker.register(MATCH_DONATION_JOB, async (job) => {
    await s.matching.matchDonation(String(job.payload.donationId));
  });
  worker.register(MATCH_REQUEST_JOB, async (job) => {
    await s.matching.matchAssistanceRequest(String(job.payload.requestId));
  });
  worker.registerRecurring({ type: EXPIRY_JOB, everySeconds: 60 }, async () => {
    await s.expiry.run();
  });
  worker.registerRecurring({ type: RETENTION_JOB, everySeconds: 3600 }, async () => {
    await s.tracking.purgeExpiredLocations();
    await s.maintenance.applyRetention();
  });
  worker.registerRecurring({ type: 'purge-ai-interactions', everySeconds: 86_400 }, async () => {
    await s.assistant.purgeOld(retentionDays);
  });
  worker.registerRecurring({ type: FORECAST_JOB, everySeconds: 6 * 3600 }, async () => {
    await s.predictions.forecastAllDonors();
  });
}

export function createWorker(ctx: AppContext, services: Services, pollMs = 1000): JobWorker {
  const worker = new JobWorker(ctx.db, ctx.logger, pollMs);
  registerJobs(worker, services, ctx.config.retention.aiInteractionDays);
  return worker;
}
