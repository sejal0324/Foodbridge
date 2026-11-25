# FoodBridge AI: Implementation Progress

Statuses: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `TESTED` · `BLOCKED`.
`TESTED` means automated tests exist and pass, with the evidence listed in [TESTING_REPORT.md](TESTING_REPORT.md).
**External-credential integrations are marked separately:** they are implemented and tested against mocked HTTP, but not
against live provider accounts.

Working tree: branch `feature/foodbridge-ai-development` (from `main` @ `6a2fd23`). Phase 0 was committed (3 commits);
everything after Phase 0 is **uncommitted local work**, per the owner's instruction (no commits or pushes).

## Phase overview

| Phase | Scope | Status |
|---|---|---|
| 0 | Initialisation, architecture, ER diagram, database design | TESTED (environment checks) |
| 1 | Database and backend foundation | TESTED |
| 2 | Authentication and user management | TESTED |
| 3 | Donation and assistance workflows, partial fulfilment, notifications | TESTED |
| 4 | Frontend core (design system, landing, auth, dashboards) | TESTED (unit and browser E2E) |
| 5 | AI foundation (forecasting, matching, allocation, backend integration) | TESTED |
| 6 | LLM assistant | TESTED (provider calls mocked; no live LLM key) |
| 7 | Pickup verification (QR pass, photo-ID check, handover, disputes) | TESTED |
| 8 | LiveTrack | TESTED |
| 9 | Rewards and billing | TESTED (Razorpay mocked) |
| 10 | Logistics optimisation (VRPTW) | TESTED |
| 11 | Analytics and insights | TESTED |
| 12 | QA, security review, Docker, documentation | TESTED |

## Feature detail

| Feature | Status | Key files | Tests | Limitations |
|---|---|---|---|---|
| Migrations (53 tables after 0012, rollback) | TESTED | `database/migrations/0001–0012` | Every backend run: all down, then all up | Forward-only in production |
| Config validation and production guards | TESTED | `backend/src/config/env.ts` | `config.test.ts` | |
| Health, errors, logging, security headers, CORS | TESTED | `app.ts`, `middleware/*` | `health.test.ts` | |
| Registration, login, lockout, JWT + rotating refresh, logout, reset, invites | TESTED | `services/auth.service.ts` | `auth.test.ts`, e2e `security.spec.ts` | |
| RBAC, ownership checks, admin provisioning (CLI only) | TESTED | `middleware/auth.ts`, `routes/index.ts`, `cli/create-admin.ts` | `auth.test.ts` and others | |
| Profiles, availability, categories, documents (signature-checked) | TESTED | `profile.service.ts`, `verification.service.ts` | `auth.test.ts`, frontend tests | Local disk storage |
| Admin verification and user suspension | TESTED | `verification.service.ts` | `auth.test.ts` | |
| Donations (create, edit with versioning, cancel, drafts, review flags) | TESTED | `donation.service.ts` | `donations.test.ts`, e2e `donor.spec.ts` | |
| NGO requests, approval, atomic reservation, batch approval | TESTED | `donation.service.ts`, `allocation.service.ts` | `donations.test.ts` (5-way race), integration scenario D | |
| Assistance requests, offers, partial fulfilment, confirm/cancel | TESTED | `assistance.service.ts` | `assistance.test.ts` (concurrent acceptance), integration scenario B | |
| Expiry and retention jobs | TESTED | `expiry.service.ts`, `maintenance.service.ts`, `tracking.service.ts` | `donations.test.ts`, `assistance.test.ts`, `integrations.test.ts`, `tracking.test.ts` | |
| Notifications (in-app, socket, email retry, preferences, dedupe) | TESTED | `notification.service.ts`, `jobs/worker.ts` | `integrations.test.ts` (retry, DEAD, admin retry) | Web Push not implemented |
| Matching (hard filters + AI weighted ranking + labelled fallback) | TESTED | `matching.service.ts`, `ai-service/app/services/matching_*` | backend and AI tests, integration scenarios A and B | Weights are initial, not validated |
| Allocation optimiser (OR-Tools) | TESTED | `ai-service/.../allocation_service.py`, `matching.service.ts` | AI tests, `donations.test.ts`, `assistance.test.ts` | |
| Surplus forecasting | TESTED | `ai-service/training/*`, `prediction.service.ts` | AI tests, `intelligence.test.ts`, integration | **Synthetic training data** |
| LLM assistant (tools, confirmation, fallback) | TESTED | `assistant.service.ts`, `ai-service/.../llm_*` | `intelligence.test.ts`, AI tests (mocked providers) | No live LLM key used |
| Pickup verification (QR pass, photo-ID check, handover, disputes, delivery) | TESTED | `pickup.service.ts` | `pickup.test.ts`, integration A and C, e2e `donor.spec.ts`, `ngo.spec.ts`, `admin.spec.ts` | A one-sided handover has no timeout yet |
| Representatives (invites, photos, revocation) | TESTED | `representative.service.ts` | `pickup.test.ts` | |
| LiveTrack (consent, viewers, staleness, retention) | TESTED | `tracking.service.ts`, `sockets/gateway.ts` | `tracking.test.ts` | Foreground browser only; Google ETA untested live |
| Rewards (10/15 per meal with the 500-meal split, 10 per order, ledger, tiers, certificates) | TESTED | `domain/rewards.ts`, `reward.service.ts` | `domain.test.ts`, `pickup.test.ts` | |
| NGO billing (₹5 per unit, tax, invoices, PDF, manual payments, Razorpay) | TESTED | `domain/fees.ts`, `billing.service.ts`, `integrations/razorpay.ts` | `domain.test.ts`, `billing.test.ts` | Razorpay mocked; GST needs professional review |
| Route planning (VRPTW) | TESTED | `planning.service.ts`, `ai-service/.../route_service.py` | `intelligence.test.ts`, AI tests | Estimated travel times without a Google key |
| Analytics, insights, public impact | TESTED | `analytics.service.ts`, `ai-service/.../insights_service.py` | `intelligence.test.ts`, e2e `public.spec.ts` | |
| India-wide coverage (geocoding, states, location validation) | TESTED | `integrations/geocoding.ts`, `utils/india.ts`, frontend `LocationPicker` | `geo.test.ts`, frontend tests, e2e | Nominatim fair-use limits |
| Frontend: landing, auth, donor area | TESTED | `frontend/src/features/{public,auth,donor,donations,assistance,pickups,…}` | frontend unit tests, e2e | |
| Frontend: NGO area | TESTED | `frontend/src/features/ngo` | frontend unit tests, e2e `ngo.spec.ts` | |
| Frontend: admin area | TESTED | `frontend/src/features/admin` | frontend unit tests, e2e `admin.spec.ts` | |
| Docker images and stack | TESTED | `deployment/docker/*`, `docker-compose.yml` | Images build; containers healthy as non-root | Production hosting not provisioned |
| Root orchestration | TESTED | `package.json`, `deployment/scripts/*` | Used for every run in TESTING_REPORT | |

## Latest verification (2026-11-04, after the OTP step was removed)

Full details are in [TESTING_REPORT.md](TESTING_REPORT.md). The AI service and Docker stack rows are from
2026-11-03 (the AI service did not change).

| Suite | Result |
|---|---|
| Backend (Vitest + Supertest, real PostgreSQL) | 116 / 116 |
| AI service (pytest) | 194 / 194 (2026-11-03) |
| Frontend (Vitest + Testing Library) | 177 / 177 |
| Integration (real backend + AI service) | 10 / 10 |
| Browser E2E (Playwright + Chrome: donor, NGO, admin, public, security, mobile) | 15 / 15 |
| Lint, typecheck | Clean |
| Docker stack | 4 containers healthy, non-root app containers (2026-11-03) |

**Fixed in this round, each with tests:**
- **Five admin-reported backend gaps:** a partial invoice run failing, "collected" ignoring partial payments, the
  dispute link, the dispute unit, and admin-cancellation wording.
- **Review findings:**
  - double dispute resolution;
  - a confirmed handover voidable by the other side;
  - revoked representatives;
  - unapproved NGOs publishing through the assistant;
  - online overpayment;
  - incomplete unwinding when a disputed collection is cancelled.
- **Smaller fixes:**
  - invoice and certificate periods now use IST days;
  - the assistance-cancel race;
  - the donation-edit status rollup.

**Known and documented, not fixed:** a rare lock-order deadlock surfaces as a retryable 409 (SECURITY.md §8).

## Decisions confirmed by the product owner (2026-11-03)

- Units are MEALS, PACKETS and BOXES only, as whole numbers.
- Rewards: 10 points per verified meal, 15 after 500 lifetime meals (split at the boundary), 10 points per verified packet or box order.
- Fee: ₹5 per verified meal, packet or box. Configurable GST, kept separate.
- Coverage is all of India.
- No git commits or pushes after Phase 0; all work stays local.

## Decisions confirmed by the product owner (2026-11-04)

- OTP step removed by the product owner on 2026-11-04; verification is QR pass + photo-ID check + two-way
  confirmation. This withdraws the earlier decision to send an SMS OTP through MSG91: SMS is no longer used anywhere.
  Forward migration `0012_remove_pickup_otp.sql` drops `otp_verifications` and `pickup_assignments.otp_verified_at`
  and deletes the `otp.policy` setting (its Down section restores them). See [PICKUP_VERIFICATION.md](PICKUP_VERIFICATION.md).
