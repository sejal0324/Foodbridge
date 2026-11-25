# FoodBridge AI: Testing Report

Every number below comes from a real run against the code in this working tree. Lint, typecheck, backend, frontend,
integration and E2E were re-run on **2026-11-04**, after the product owner removed the OTP step from pickup
verification (see "OTP step removed" below). The AI service suite and the Docker stack check are from the
**2026-11-03** run; the AI service was not changed. Nothing was estimated, and no suite was skipped. Provider
integrations that need live credentials (Razorpay, Google Maps, LLM providers) are tested against **mocked HTTP
only**; see "Not tested live" at the end.

## Environment

| Item | Version |
|---|---|
| OS | Linux 6.8 (x86-64) |
| Node.js | 24.19.0 |
| Python (AI service, via uv) | 3.12.16 |
| Database | `postgis/postgis:18-3.6` (Docker, host port 5433) |
| Browser for E2E | Google Chrome 151, Playwright 1.64.1 |

Backend, integration and E2E suites all use the `*_test` database (`TEST_DATABASE_URL`), which they rebuild. The
backend suite migrates every table down and back up on each run. The development database is never touched.

## Results

| Suite | Command | Result |
|---|---|---|
| Lint (backend ESLint, frontend ESLint, AI ruff) | `npm run lint` | **Pass** (0 problems) |
| Typecheck (backend and frontend `tsc`) | `npm run typecheck` | **Pass** |
| Backend unit and API | `npm run test:backend` | **116 / 116 passed** (12 files) |
| AI service | `npm run test:ai` | **194 / 194 passed** (2026-11-03) |
| Frontend unit | `npm run test:frontend` | **177 / 177 passed** (29 files) |
| Cross-service integration (real backend and AI service, no mocks) | `npm run test:integration` | **10 / 10 passed** (2 files) |
| Browser E2E (Playwright, Chrome, isolated full stack) | `npm run test:e2e` | **15 / 15 passed** (1.3 min) |
| Docker stack | `npm run stack:up` | All 4 containers healthy; app containers run as non-root (details below; 2026-11-03) |

### Backend tests per file

| File | Tests | File | Tests |
|---|---|---|---|
| `auth.test.ts` | 17 | `domain.test.ts` | 11 |
| `donations.test.ts` | 18 | `assistance.test.ts` | 9 |
| `pickup.test.ts` | 15 | `billing.test.ts` | 9 |
| `intelligence.test.ts` | 9 | `config.test.ts` | 7 |
| `health.test.ts` | 7 | `geo.test.ts` | 6 |
| `integrations.test.ts` | 4 | `tracking.test.ts` | 4 |

### Browser E2E scenarios (all passing)

| Spec | Scenario |
|---|---|
| `donor.spec.ts` | Donor publishes a donation, sees AI-ranked NGO recommendations, approves a request, verifies the representative (pass code, then the photo-ID check), completes the two-way handover and sees 400 points |
| `donor.spec.ts` | A forged pickup pass is rejected honestly |
| `donor.spec.ts` | A donor in another city sees that city on the map and in recommendations |
| `ngo.spec.ts` | NGO requests a marketplace donation (sees the 25 × ₹5.00 = ₹125.00 estimate first), assigns its representative, shows the QR pass, confirms the handover and is billed ₹125.00 |
| `ngo.spec.ts` | NGO publishes an assistance request through the form, accepts a donor offer (₹300.00 estimate) that fully covers it |
| `admin.spec.ts` | Admin approves a pending NGO; that NGO's session becomes APPROVED |
| `admin.spec.ts` | Admin resolves a quantity-mismatch dispute (unit shown); it leaves the open list and the NGO is billed once, for the agreed quantity |
| `admin.spec.ts` | Admin invoices a collection, records a partial offline payment, and "Collected" rises by exactly that amount |
| `public.spec.ts` | Landing page shows live impact numbers; registration offers India-wide location search and all states |
| `security.spec.ts` | Anonymous redirects, role isolation, access token never in web storage, pending-organisation notice |
| `responsive.spec.ts` | Landing page and donor dashboard on a phone-sized screen |

### Docker stack check

`npm run stack:up` built all images from the current source and started db, ai-service, backend and frontend; all four
reported healthy. Through the nginx single origin (`http://localhost:8080`):

- The SPA and a deep link (`/ngo/billing`) return 200.
- `/api/health/ready` reports `database: ok`.
- Admin login works.
- `/ai/*` is **not** proxied (it returns the SPA's HTML), so the AI service stays private.

Backend and AI containers run as user `foodbridge`, and the frontend runs as uid 101.

## OTP step removed (2026-11-04)

The product owner removed the OTP step. Pickup verification is now QR pass → the donor's photo-ID check (pickup
becomes VERIFIED) → two-way handover confirmation. Migration `0012_remove_pickup_otp.sql` drops `otp_verifications`
and `pickup_assignments.otp_verified_at`. Its up and down were both run: the backend suite migrates every table down
and back up, and one run started from a test database holding 5 pickups verified without an OTP (1 DELIVERED,
4 HANDED_OVER), which exercises the down backfill. It was also applied forward to the development database.

- **Deleted tests:** OTP attempt limit, expiry and resend cooldown; refusal to send an OTP without SMS; the two
  MSG91 adapter tests; the `OTP_DEV_MODE` production guard; the MSG91 credential check. The OTP steps were removed
  from the integration workflow and from the E2E donor flow and helpers.
- **Added or changed tests (`pickup.test.ts`, `config.test.ts`, `health.test.ts`):**
  - the scan returns only the pickup, and the log records `QR` then `IDENTITY_CHECK`;
  - the identity step is refused before the QR pass is verified (`409 VERIFICATION_INCOMPLETE`) and for another
    donor (404);
  - the removed OTP endpoints return 404;
  - a representative deactivated after verification is refused at handover, from both sides
    (`403 REPRESENTATIVE_INACTIVE`);
  - a revoked representative is stopped at the identity step;
  - leftover OTP/SMS variables in an older `.env` are ignored;
  - readiness reports only the email, maps and payments integrations.
- **Kept:** coverage for forged, reused, expired and revoked passes, the wrong donor, and representative revocation.

## Bugs found and fixed in this round

Each fix lists its test. The dedicated regression tests assert error codes and states that the old code did not
produce. R8 and R9 have no dedicated test; they are covered only by the existing suites, which still pass.

**Admin-reported gaps:**

| # | Bug | Fix | Test |
|---|---|---|---|
| 1 | One NGO already invoiced for a period made the whole invoice run fail (`409 INVOICE_EXISTS`), so other NGOs' invoices were committed but never announced | That NGO is skipped (no invoice number consumed); the others are invoiced | `billing.test.ts` "skips an NGO already invoiced…" |
| 2 | "Collected" revenue ignored partial and manual payments | Collected = successful payments; billing and analytics share one query | `billing.test.ts` "counts partial and manual payments…", e2e admin 3 |
| 3 | Dispute-resolved notifications linked to `/` | They link to each party's pickup | `pickup.test.ts` dispute test |
| 4 | `/disputes` rows had no `unit` | `unit` added; the admin page no longer fetches each pickup to find it | `pickup.test.ts` dispute test, e2e admin 2 |
| 5 | When an admin cancelled a donation, the NGO was told "<donor> cancelled…" | Wording names the administrator | `donations.test.ts` "tells NGOs when an administrator…" |

**Independent backend review:**

| # | Severity | Bug | Fix | Test |
|---|---|---|---|---|
| R1 | High | A dispute could be resolved twice (for example a double click), releasing reserved quantity twice or billing a cancelled collection | The dispute is re-read under lock; the allocation must still be DISPUTED | `pickup.test.ts` "resolves a dispute exactly once…" (two concurrent requests) |
| R2 | High | After the representative was verified, either side could cancel or report failure and void a handover the other side had already confirmed (no fee, no points, food re-listed) | Cancelling is refused once a pickup is VERIFIED (`409 HANDOVER_IN_PROGRESS`); reporting failure after a one-sided confirmation opens a dispute for an admin | `pickup.test.ts` "does not let either side void a handover…" |
| R3 | Medium | A revoked representative could still complete the verification checks, confirm handovers and read NGO-wide lists | The representative must be ACTIVE for the identity check and handover; revocation revokes unconsumed passes; NGO scope ignores inactive representatives | `pickup.test.ts` "stops a revoked representative…" |
| R4 | Medium | An NGO that was no longer approved could publish an assistance request through the AI assistant, and two concurrent confirmations could create two requests | Approval is enforced inside `assistance.create`; the pending action is claimed atomically | `intelligence.test.ts` "does not let an NGO that is no longer approved…" |
| R5 | Medium | Two checkouts, or a checkout plus a bank transfer, could pay an invoice twice with nothing flagged | The open order is reused (blocked while one awaits confirmation); the webhook locks the invoice, records real money, flags any excess as `OVERPAYMENT` and alerts admins | `billing.test.ts` "reuses the open order…" |
| R6 | Medium | Cancelling a disputed collection did not unwind the request or offer, passes or tracking | Goes through the same full release path as any cancellation | `pickup.test.ts` "resolves a dispute exactly once…" |
| R8 | Low | Cancelling an assistance request could race a handover | Donations and allocations are locked before the "already collected" check | Existing assistance tests (no deterministic race test) |
| R9 | Low | Editing a donation with completed allocations could leave it stuck in RESERVED | Status is rolled up from allocations after an edit | Existing donation tests |
| TZ | Medium | Invoice and certificate periods used the database timezone (UTC) though the UI shows IST dates; fee lines from 00:00–05:30 IST could be missed | Periods are IST calendar days | `billing.test.ts` "treats invoice periods as India (IST) calendar days…" |

**Also changed:** the admin "Collected" hint now reads "Payments received, including partial and offline payments".
This was found by the new E2E test.

**Not changed (R7, low):** the assistance service and the pickup service lock rows in different orders (request →
offer → donation, versus donation → offer). A rare simultaneous "withdraw offer" and "cancel allocation" can deadlock.
PostgreSQL detects this, and the API returns a retryable `409 CONCURRENT_UPDATE`; no data is corrupted. Reordering one
path alone would only move the cycle, so a single global lock order is listed as future work.

## Not tested live

- **Razorpay, Google Maps/Routes and the Gemini/OpenAI adapters:** tested with mocked HTTP only. No live
  credentials were used.
- **LiveTrack GPS:** unit and API tests use fixed coordinates. The browser E2E tests do not feed real geolocation.
- **Camera QR scanning:** headless Chrome has no camera. The pass-code path is tested end to end.
- **Forecasting model:** trained and evaluated on **synthetic data** (see AI_MODEL_EVALUATION.md). Its accuracy figures do
  not represent real-world performance.
- **Not covered:** load testing, multi-instance deployment and automated accessibility (axe) audits.
