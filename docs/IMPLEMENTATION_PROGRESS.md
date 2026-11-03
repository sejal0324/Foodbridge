# FoodBridge AI: Implementation Progress

Statuses: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `TESTED` · `BLOCKED`

A feature is marked `TESTED` only when automated tests exist and pass, with the
evidence recorded here. A page that renders is not evidence.

Branch: `feature/foodbridge-ai-development` (from `main` @ `6a2fd23`)

---

## Roadmap overview

| Phase | Scope | Status |
|---|---|---|
| 0 | Project initialisation, architecture, ER diagram, database design | IMPLEMENTED |
| 1 | Database and backend foundation (migrations, Express, config, health, errors, logging, validation, test framework) | NOT STARTED |
| 2 | Authentication and user management (registration, login, JWT/refresh, RBAC, profiles, verification) | NOT STARTED |
| 3 | Core donation and assistance workflows (reservations, partial fulfilment, notifications, history) | NOT STARTED |
| 4 | Frontend core (design system, landing, auth, dashboards, forms, marketplace) | NOT STARTED |
| 5 | AI foundation (FastAPI, dataset, surplus prediction, evaluation, matching, allocation, Node integration) | NOT STARTED |
| 6 | LLM assistant (provider adapter, authorised tools, confirmations, fallback) | NOT STARTED |
| 7 | Pickup verification (representatives, QR, OTP, two-way handover, disputes) | NOT STARTED |
| 8 | LiveTrack (sessions, GPS, Socket.IO, maps, ETA, retention) | NOT STARTED |
| 9 | Rewards and billing (ledger, tiers, certificates, fees, invoices, Razorpay) | NOT STARTED |
| 10 | Logistics optimisation (OR-Tools VRPTW, collection plans) | NOT STARTED |
| 11 | Analytics and AI insights | NOT STARTED |
| 12 | Final QA, security review, deployment | NOT STARTED |

---

## Phase 0: Project initialisation

**Status:** IMPLEMENTED (design and environment; no application code yet)

### Done

| Item | Result |
|---|---|
| Repository verified | `main` was clean and up to date with `origin/main`. One commit, `6a2fd23`, preserved unchanged |
| Git identity verified | `Sejal <sejaldharamthok24@gmail.com>` (global config), matching the initial commit's author and committer |
| Remote verified | `origin` → `https://github.com/sejal0324/Foodbridge.git` (only `main` on the remote) |
| Feature branch | `feature/foodbridge-ai-development` created locally (not pushed) |
| Tooling verified | Node 24.19, npm 11.17, Docker 29.1 with Compose 2.40, Python 3.12.16 (via uv 0.13.7), psql 14 client |
| Folder structure | Spec §7 structure created. `.gitkeep` keeps empty directories in Git |
| Root config | `.env.example`, `.editorconfig`, `.gitattributes`, `.nvmrc` (24), `.gitignore` extended (original entries kept) |
| Database environment | `docker-compose.yml` (root) includes `database/docker-compose.yml`: PostgreSQL 18.6 + PostGIS 3.6.4 on `127.0.0.1:5433`, healthcheck, named volume, separate `foodbridge_test` database |
| Backend TypeScript setup | `backend/package.json`, `tsconfig.json` (strict, NodeNext ESM), `tsconfig.build.json`; TypeScript 6.0.3 and @types/node 24 pinned with a lockfile |
| Python environment | `ai-service/.python-version` (3.12); `ai-service/.venv` created with uv (gitignored) |
| Architecture | [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md): components, authority boundaries, flows, auth design, degradation matrix, decision log |
| Database design | [DATABASE_DESIGN.md](DATABASE_DESIGN.md): 53 tables, constraints, concurrency strategy, state machines, retention, migrations |
| ER diagram | [ER_DIAGRAM.md](ER_DIAGRAM.md): an overview plus six domain diagrams |

### Verification performed

These are checks of the environment, not application tests. Outputs were observed directly.

- `docker compose config --quiet` succeeds. `docker compose up -d db` reaches `healthy`.
- From the host via `DATABASE_URL`: `PostgreSQL 18.6`, `SHOW timezone` = `UTC`. Databases
  `foodbridge` and `foodbridge_test` exist. Extensions `postgis 3.6.4`, `citext 1.8` and
  `pgcrypto 1.4` are available. `gen_random_uuid()` works. The port is bound to `127.0.0.1` only.
- Design constraints were checked on PostgreSQL 18, in transactions that were rolled back:
  - The `link_path` CHECK accepts `/donations/1` and `/`, and rejects `//evil.com`, `/\evil.com` and `https://evil.com`.
  - The handover CHECK rejects `CONFIRMED` with a NULL or mismatched NGO quantity. This caught a NULL-passes-CHECK bug in the first draft.
  - `UNIQUE NULLS NOT DISTINCT` rejects a duplicate candidate row.
  - The `reserved_quantity <= quantity` CHECK rejects over-reservation.
  - A conditional reservation `UPDATE` affects 0 rows when the quantity is insufficient and 1 row when it is sufficient.
- The backend tsconfig typechecks a probe module (ESM imports, `node:` built-ins,
  `noUncheckedIndexedAccess`) with TypeScript 6.0.3: exit code 0. The probe lived in the
  scratchpad and was not committed.
- uv creates the Python 3.12.16 venv. A dry-run resolve finds fastapi 0.162, scikit-learn 1.9.1,
  ortools 9.15, pandas 3.1 and numpy 2.5 for Python 3.12. Nothing was installed yet.
- All 12 Mermaid diagrams (in the ER and architecture docs) render with mermaid-cli 12.2 without errors.

### Database changes

None. Phase 0 is design only. The first migrations arrive in Phase 1.

### APIs created

None.

### Known limitations and notes

- The frontend toolchain (Vite, React, Tailwind) is scaffolded in Phase 4, so the empty
  structure is only placeholders until then.
- `docker-compose.yml` runs only the database for now. Backend, AI service and frontend
  services are added as each gets a Dockerfile.
- Port 4000 is used by another project on the development machine, so the backend uses 5001.
  Port 5432 is used by a local PostgreSQL 14, so Docker PostgreSQL uses 5433.
- TypeScript is pinned to 6.0.x (not 7.x) because typescript-eslint currently supports TypeScript below 6.1.
- `database/init/.gitkeep` is a leftover placeholder next to the init script. It is harmless.

### Open product questions

See [SYSTEM_ARCHITECTURE.md §15](SYSTEM_ARCHITECTURE.md#15-open-questions-for-the-product-owner):
the reward formula outside the brackets, the fee amount and GST, the SMS provider, and the unit set.

---

## Phase 1: Database and backend foundation

**Status:** NOT STARTED

Planned:

- node-pg-migrate setup; first migrations (extensions, `set_updated_at`, `forbid_mutation`,
  `platform_settings`, `audit_logs`, `idempotency_records`, `jobs`).
- Express app with request IDs, helmet, CORS, body limits, structured logging (pino) with redaction.
- Config validation (Zod) with production guards.
- `GET /api/health` (liveness) and readiness (database check).
- Central error handling with a consistent error envelope.
- Vitest + Supertest against the `foodbridge_test` database.
