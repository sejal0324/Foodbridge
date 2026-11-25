# Deployment Guide

## 1. Local development (recommended for review)

Prerequisites: Node.js 24, Docker with Compose v2.20+, Python 3 (used only to bootstrap `uv`), and Google Chrome (for the
optional browser E2E tests).

```bash
npm run setup      # .env with generated secrets, dependencies, Python venv, DB, migrations, demo data
npm run dev        # DB + backend (:5001) + AI service (:8001) + frontend (:5173)
```

| URL | What |
|---|---|
| http://localhost:5173 | Web app (the Vite dev server proxies `/api` and `/socket.io`) |
| http://localhost:5001/api/health · `/api/health/ready` | Backend liveness and readiness |
| http://localhost:8001/ai/health | AI service |

Stop the app with Ctrl+C and the database with `npm run db:down`. To reset the demo data: `npm run db:reset`.

## 2. Containerised stack (local, production-like)

```bash
npm run stack:up     # builds backend, AI service and frontend images; starts everything; waits for health
open http://localhost:8080
npm run stack:down
```

- nginx serves the SPA and reverse-proxies `/api` and `/socket.io`, giving one origin for the browser.
- The backend applies pending migrations at start (`RUN_MIGRATIONS=true`).
- Images run as non-root users and have Docker `HEALTHCHECK`s.
- The local stack keeps `NODE_ENV=development` so the development log-email provider keeps working over plain HTTP.

## 3. Production deployment

| Component | Suggested host | Notes |
|---|---|---|
| Database | Managed PostgreSQL 16+ **with PostGIS** (Render, Railway, Neon, Supabase, RDS) | Enable `postgis` and `citext` (the first migration does it if permitted). Daily backups plus PITR |
| Backend | Render or Railway web service using `deployment/docker/backend.Dockerfile` (context = repo root) | Health check `/api/health`. `RUN_MIGRATIONS=true` on one instance, or run `node dist/db/migrate.js up` as a release step |
| AI service | Render or Railway **private** service using `deployment/docker/ai-service.Dockerfile` (context = `ai-service/`) | Not exposed publicly; the backend reaches it with `INTERNAL_SERVICE_TOKEN` |
| Frontend | `deployment/docker/frontend.Dockerfile` (nginx), or a static host (Vercel) **plus a same-site API** | The refresh cookie is first-party: serve the API on the same site (nginx proxy, Vercel rewrite of `/api`, or `app.` and `api.` subdomains of one domain) |

### Required production configuration

```env
NODE_ENV=production
DATABASE_URL=postgresql://…           # app role (least privilege)
JWT_ACCESS_SECRET=…                   # ≥ 32 random characters
INTERNAL_SERVICE_TOKEN=…              # same value in the AI service
CORS_ORIGINS=https://app.example.org
APP_BASE_URL=https://app.example.org
TRUST_PROXY=true
EMAIL_PROVIDER=smtp SMTP_HOST=… SMTP_USER=… SMTP_PASSWORD=… EMAIL_FROM=…
UPLOAD_DIR=/data/uploads              # persistent volume (or swap LocalFileStorage for object storage)
# optional
GOOGLE_MAPS_SERVER_API_KEY=…  RAZORPAY_KEY_ID=…  RAZORPAY_KEY_SECRET=…  RAZORPAY_WEBHOOK_SECRET=…
LLM_PROVIDER=gemini|openai  GEMINI_API_KEY=… / OPENAI_API_KEY=…   (AI service)
```

The backend **refuses to start** when production rules are violated: placeholder or short secrets, the development email
provider, insecure cookies, or wildcard CORS.

### Release checklist

1. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:integration` locally. All must pass.
2. Build the images; apply migrations (forward-only) before switching traffic.
3. Create the first administrator: `docker compose exec backend node dist/cli/create-admin.js --email … --name "…"`
   with `ADMIN_PASSWORD` set, or `npm run admin:create` against the target database.
4. Configure the Razorpay webhook URL `https://<domain>/api/billing/webhooks/razorpay` (events `payment.captured` and
   `payment.failed`).
5. Validate GST treatment with a professional before enabling `billing.tax`.
6. **Never** run `npm run db:seed` or `db:reset` in production (both refuse when `NODE_ENV=production`).
7. Monitor `/api/health/ready`, the admin Jobs page (DEAD jobs) and notification deliveries.

## 4. Operations

| Task | Command |
|---|---|
| Migrate | `npm run db:migrate` (or `node dist/db/migrate.js up` in the container) |
| Roll back the last migration (development only) | `npm --prefix backend run db:migrate:down` |
| Create an admin | `npm run admin:create -- --email admin@example.org --name "Name"` |
| Retrain the forecaster | `cd ai-service && .venv/bin/python -m training.train` (see AI_MODEL_EVALUATION.md) |
| Logs | Structured JSON on stdout (pino / JSON logging in Python). Ship them to your log platform |
| Background jobs | Run inside the backend process (`JOB_WORKER_ENABLED`); safe on several instances (`SKIP LOCKED`) |
