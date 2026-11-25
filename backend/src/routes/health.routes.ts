import { Router } from 'express';
import type { AppContext } from '../container.js';

const startedAt = Date.now();
export const VERSION = '1.0.0';

export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  /** Liveness: the process is up. Never touches dependencies. */
  router.get('/', (_req, res) => {
    res.json({
      data: { status: 'ok', service: 'foodbridge-backend', version: VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), timestamp: new Date() },
    });
  });

  /** Readiness: the database must be reachable. Optional dependencies are reported but never fail readiness. */
  router.get('/ready', async (_req, res) => {
    const database = await ctx.db.ping();
    const integrations = {
      email: ctx.email.configured ? ctx.email.name : 'not_configured',
      maps: ctx.config.maps.serverApiKey ? 'configured' : 'not_configured',
      payments: ctx.config.razorpay.enabled ? 'razorpay' : 'not_configured',
    };
    res.status(database ? 200 : 503).json({
      data: { status: database ? 'ready' : 'not_ready', checks: { database: database ? 'ok' : 'unavailable' }, integrations },
    });
  });

  return router;
}
