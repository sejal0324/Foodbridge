import { createServer } from 'node:http';
import { createApp } from './app.js';
import { ConfigError, loadEnvFiles, parseConfig } from './config/env.js';
import { createContext, createServices, createWorker } from './container.js';
import { attachSocketGateway } from './sockets/gateway.js';

async function main(): Promise<void> {
  loadEnvFiles();
  let config;
  try {
    config = parseConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const ctx = createContext(config);
  const services = createServices(ctx);
  const app = createApp(ctx, services);
  const server = createServer(app);
  const io = attachSocketGateway(server, ctx, services);
  const worker = createWorker(ctx, services);

  if (!(await ctx.db.ping())) ctx.logger.warn('database not reachable at startup; requests will fail until it is available');
  if (config.jobs.workerEnabled) worker.start();

  server.listen(config.port, () => ctx.logger.info({ port: config.port, env: config.env }, 'FoodBridge backend listening'));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await worker.stop();
    await io.close();
    server.close();
    await ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
