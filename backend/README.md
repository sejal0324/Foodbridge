# FoodBridge AI: Backend

Node.js 24 + Express 5 + TypeScript. The authority for identity, permissions, state, quantities, verification,
rewards, billing and audit. PostgreSQL 18 + PostGIS via `pg` with parameterised SQL.

```
src/
  app.ts            Express app (middleware order, error handler); no listeners
  server.ts         Entry point: HTTP + Socket.IO + job worker + graceful shutdown
  container.ts      Composition root: AppContext (config, db, integrations) → services → job registrations
  config/           env.ts (Zod-validated config + production guards), logger.ts (pino + redaction)
  db/               database.ts (pool, transactions), migrate.ts, seed.ts (dev demo), reset.ts (dev)
  domain/           Pure business rules: state machines, reward and fee calculation (unit-tested)
  routes/           index.ts: every route with its auth/role guards; health.routes.ts
  controllers/      HTTP mapping only (parse → service → envelope)
  services/         Business logic and transactions (one module per domain)
  repositories/     Reusable SQL (users, sessions, organisations, donations)
  middleware/       request id, auth/RBAC, idempotency, rate limit, error handler
  validators/       Zod request schemas
  integrations/     AI service client, SMTP/dev email, Google Routes, Razorpay, file storage
  jobs/             Postgres-backed queue (outbox) and worker (SKIP LOCKED, backoff, DEAD jobs)
  sockets/          Socket.IO gateway + Realtime abstraction
  cli/              create-admin.ts (server-side admin provisioning)
tests/              Vitest + Supertest against a real PostgreSQL test database
```

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Watch mode on :5001 (reads the repository-root `.env`) |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm test` | Rebuilds `foodbridge_test` (all migrations down, then up) and runs every test file sequentially |
| `npm run lint` / `npm run typecheck` | ESLint (typescript-eslint) / `tsc --noEmit` |
| `npm run db:migrate` · `db:migrate:down` · `db:migrate:test` | Migrations (`database/migrations`) |
| `npm run db:seed` · `db:reset` | Development demo data (refused in production) |
| `npm run admin:create -- --email … --name "…"` | Create an administrator (`ADMIN_PASSWORD` or prompt) |

## Conventions

- **Responses:** `{ data, meta? }`; errors `{ error: { code, message, details?, requestId } }` (see `utils/errors.ts`).
- **Authorization:** route guards in `routes/index.ts` plus ownership checks inside services. Resources the caller may not
  see return 404.
- **Transactions:** every state change is one transaction that also writes history and audit rows and enqueues jobs
  (transactional outbox). Notifications are created inside it and published to sockets after commit.
- **Locking order:** assistance request → offer → donation → donation request → allocation → pickup.
- **Statuses:** transitions go through `domain/state-machines.ts`.
- **Integrations** are behind interfaces and are replaceable in tests (`ContextOverrides`). Unconfigured integrations
  degrade honestly and never fake success.

API reference: [docs/API_DOCUMENTATION.md](../docs/API_DOCUMENTATION.md).
