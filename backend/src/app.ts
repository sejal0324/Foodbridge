import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext, Services } from './container.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { buildApiRouter } from './routes/index.js';

/** Builds the Express application. No network listeners are opened here (see server.ts). */
export function createApp(ctx: AppContext, services: Services): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.config.trustProxy ? 1 : false);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/health') },
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || ctx.config.corsOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  // Payment webhooks need the exact raw bytes for signature verification.
  app.use('/api/billing/webhooks', express.raw({ type: 'application/json', limit: '100kb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.use('/api', buildApiRouter(ctx, services));
  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
