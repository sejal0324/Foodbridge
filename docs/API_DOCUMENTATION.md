# FoodBridge AI: API Documentation

Base URL: `/api` (local: `http://localhost:5001/api`; through the web app or nginx it is same-origin `/api`).
The AI service has its own internal API, documented in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md); browsers never call it.

The source of truth is the code. Routes, with their authentication and role guards, are in
[`backend/src/routes/index.ts`](../backend/src/routes/index.ts). Request schemas (Zod) are in
[`backend/src/validators/`](../backend/src/validators/). This document summarises them.

---

## 1. Conventions

| Topic | Convention |
|---|---|
| Success | `{ "data": … }`; paginated lists add `"meta": { "page", "pageSize", "total" }` (`?page=1&pageSize=20`, max 100) |
| Errors | `{ "error": { "code", "message", "details?", "requestId" } }`. `message` is safe to show to users |
| Request id | Send `X-Request-Id` (8–64 chars `[A-Za-z0-9_-]`) or one is generated; it is echoed in a header and in errors |
| Auth | `Authorization: Bearer <accessToken>` (JWT, 15 min). The refresh token is an httpOnly cookie `fb_refresh` (path `/api/auth`, SameSite=Strict) |
| Idempotency | `POST /donations`, `POST /donations/:id/requests`, `POST /assistance-requests` and `POST /assistance-requests/:id/offers` accept an `Idempotency-Key` header. A repeated key with the same body replays the stored response (`Idempotent-Replayed: true`); the same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED` |
| Optimistic locking | `PATCH /donations/:id` and `PATCH /assistance-requests/:id` require the current `version`. A stale version returns `409 STALE_VERSION` |
| Quantities | Whole numbers. Units are `MEALS`, `PACKETS` and `BOXES` only |
| Time | ISO 8601 with an offset; stored and returned in UTC |
| Distances | `distanceSource` is `STRAIGHT_LINE_ESTIMATE` or `ROAD_GOOGLE_ROUTES`. Estimates are always labelled |
| Coverage | FoodBridge serves **all of India**. Every place location (organisations, donations, requests, offers, destinations, plans) must lie within India's bounding box (mainland plus Lakshadweep and the Andaman & Nicobar Islands), otherwise `422 LOCATION_OUTSIDE_INDIA` with the field path in `details`. Matching is local: each NGO's own collection radius applies, wherever it is in India |

### Common error codes

| HTTP | Codes |
|---|---|
| 400 | `MALFORMED_JSON`, `BAD_REQUEST`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_PAYMENT_SIGNATURE`, `INVALID_WEBHOOK_SIGNATURE` |
| 401 | `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `REFRESH_TOKEN_REUSED` |
| 403 | `FORBIDDEN`, `ORGANISATION_NOT_APPROVED`, `ACCOUNT_SUSPENDED`, `ORIGIN_NOT_ALLOWED`, `REPRESENTATIVE_INACTIVE` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND`. Resources you may not see also return 404, so their existence is not revealed |
| 409 | `INSUFFICIENT_QUANTITY`, `DONATION_NOT_AVAILABLE`, `INVALID_STATE_TRANSITION`, `STALE_VERSION`, `DUPLICATE_REQUEST`, `DUPLICATE_OFFER`, `ALREADY_CONFIRMED`, `HANDOVER_NOT_ALLOWED`, `VERIFICATION_INCOMPLETE`, `CONCURRENT_UPDATE`, `DUPLICATE` |
| 413 | `PAYLOAD_TOO_LARGE` (JSON > 200 KB), `FILE_TOO_LARGE` (> 10 MB) |
| 422 | `VALIDATION_ERROR` (with `details: [{path, message}]`), `LOCATION_OUTSIDE_INDIA`, `QR_REJECTED` (with `details.reason`), and the business-rule codes listed in each section |
| 429 | `RATE_LIMITED`, `LOGIN_LOCKED` |
| 503 | `DATABASE_UNAVAILABLE`, `PAYMENTS_NOT_CONFIGURED`, `GEOCODING_UNAVAILABLE` |

Role shorthand: **D** = donor (approved organisation unless noted), **N** = NGO owner (approved),
**NM** = NGO member (owner or active representative), **A** = admin, **any** = any signed-in user,
**public** = no authentication.

---

## 2. Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness (no dependencies touched) |
| GET | `/health/ready` | public | Readiness: returns 503 if the database is down. Also reports honestly which integrations are configured: `integrations` is `{ email, maps, payments }` |
| GET | `/public/impact` | public | Aggregate impact figures for the landing page, with `dataLabel` (`MIXED` when demo data is present) |
| GET | `/geo/search?q=` | public (30/min per IP) | India-only address search → `{ provider: 'GOOGLE'\|'OPENSTREETMAP', results: [{ label, lat, lng, city, state, postalCode }] }`. Google Geocoding when `GOOGLE_MAPS_SERVER_API_KEY` is set, otherwise OpenStreetMap Nominatim (≤ 1 request/s, cached 24 h, attribution required). `503 GEOCODING_UNAVAILABLE` when the provider fails |
| GET | `/geo/reverse?lat=&lng=` | public (30/min per IP) | Address fields for a point in India ("use my current location") |
| GET | `/geo/states` | public | All 28 states and 8 union territories |

## 3. Authentication

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/auth/register` | public (rate-limited) | `{ accountType: 'DONOR'\|'NGO', email, password, fullName, phone?, organization: { name, businessType? (donor), licenseNumber? (donor), registrationNumber? (NGO), addressLine?, city?, state?, postalCode?, location?: {lat,lng} } }`. Admin accounts cannot be registered. Returns `{ user, accessToken, accessTokenExpiresAt }` and sets the refresh cookie |
| POST | `/auth/login` | public (10 / 15 min per IP + email) | `{ email, password }`. Five failures lock the account for 15 minutes (`429 LOGIN_LOCKED`) |
| POST | `/auth/refresh` | refresh cookie | Rotates the refresh token. Reuse of a rotated token revokes the session family. A foreign `Origin` returns 403 |
| POST | `/auth/logout` | bearer or refresh cookie | Revokes the session immediately |
| GET | `/auth/me` | any | `{ id, email, fullName, role, accountStatus, adminLevel, organization, representative }` |
| POST | `/auth/accept-invite` | public | `{ token, password }`. A representative activates an invitation (single use, 72 h) |
| POST | `/auth/password-reset/request` | public | `{ email }`. Always returns `202`, so it cannot be used to discover accounts |
| POST | `/auth/password-reset/confirm` | public | `{ token, password }`. Single use, 1 h; revokes all sessions |
| POST | `/auth/change-password` | any | `{ currentPassword, newPassword }`. Ends all other sessions |

Password policy: 10–128 characters, with at least one letter and one digit. Hashing is Argon2id.

## 4. Profiles, documents and notifications

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| GET | `/food-categories` | public | Active categories. `reviewFlagHoursAfterPreparation` is a review flag, **not** a safety certification |
| GET / PATCH | `/donors/me` | DONOR | Business details, `location`, `acceptsAssistanceRequests`, `pausedUntil`, `publicRecognitionConsent`. Editing a REJECTED profile resubmits it for review |
| PUT | `/donors/me/availability` | DONOR | `{ slots: [{ isoDayOfWeek 1–7, opensAt 'HH:MM', closesAt }] }` |
| PUT | `/donors/me/categories` | DONOR | `{ categoryIds }`: categories the donor produces |
| GET / PATCH | `/ngos/me` | NGO | Organisation details, `acceptsVeg`, `acceptsNonVeg`, `maxDailyCapacity`, `collectionRadiusKm` (≤ 100), `beneficiariesCount`, `hasRefrigeration`, `defaultVehicleCapacity` |
| PUT | `/ngos/me/food-preferences` | NGO | `{ categoryIds }`: accepted categories (a hard matching filter) |
| POST | `/verification-documents` | DONOR/NGO owner | multipart: `file` (PDF/JPEG/PNG, detected by content, ≤ 10 MB) plus `documentType` |
| GET | `/verification-documents` | DONOR/NGO owner | Own documents |
| GET | `/verification-documents/:id/file` | owner or A | Download (private; served only through this endpoint) |
| GET | `/notifications` | any | `?unreadOnly=true&page&pageSize`; `meta.unread` |
| PATCH | `/notifications/:id/read` · POST `/notifications/read-all` | any | |
| GET / PUT | `/notifications/preferences` | any | `{ emailEnabled, maxPerHour (1–100), maxDistanceKm \| null, quietHoursStart, quietHoursEnd }` |

Real-time: Socket.IO at `/socket.io` with `auth: { token }`. It emits `notification:new`, and
`tracking:location`, `tracking:event` and `tracking:ended` to members of `tracking:join` rooms.

## 5. Workflow A: donations, requests, allocations

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/donations` | D | `{ foodName, categoryId, dietaryType 'VEG'\|'NON_VEG', quantity, unit, preparedAt, bestBefore?, storageType, storageNotes?, pickupAvailableFrom?, pickupDeadline, location?, address?, description?, safetyConfirmed, publish (default true) }`. Errors: `SAFETY_CONFIRMATION_REQUIRED`, `PREPARED_IN_FUTURE`, `DEADLINE_TOO_SOON`, `LOCATION_REQUIRED`. Returns non-blocking `warnings` |
| GET | `/donations` | any | Donor: own (`scope=mine`). NGO: marketplace (`scope=marketplace`, with `distanceKm` from the NGO, `maxDistanceKm`, `sort=distance\|deadline\|newest`). Admin: `scope=all`. Filters: `status`, `categoryId`, `dietaryType` |
| GET | `/donations/:id` | owner, involved/eligible NGO, A | Includes `history`, `requests`, `allocations` and `warnings` (owner) |
| PATCH | `/donations/:id` | D owner | `{ version, …editable fields, publish? }`. Quantity cannot go below the reserved quantity |
| POST | `/donations/:id/cancel` | D owner, A | `{ reason }`. Releases unpicked reservations; blocked once any food has been handed over |
| POST | `/donations/:id/requests` | N | `{ quantity, message? }`. Returns `feeEstimate`. Errors: `DIETARY_INCOMPATIBLE`, `CATEGORY_NOT_ACCEPTED`, `INSUFFICIENT_QUANTITY`, `DUPLICATE_REQUEST` |
| POST | `/donations/:id/approve-batch` | D owner | `{ allocations: [{ requestId, quantity }] }`. All or nothing (applies a reviewed optimiser proposal) |
| GET | `/requests` | any | Donor: incoming; NGO: own; admin: all. `?status&donationId` |
| PATCH | `/requests/:id/approve` | D owner | `{ quantity? }` (a partial approval is allowed). Atomic reservation; `409 INSUFFICIENT_QUANTITY` when it would over-allocate |
| PATCH | `/requests/:id/reject` · `/requests/:id/withdraw` | D owner · N | |
| GET | `/allocations` | any | Collections (the unit of pickup) with `pickup` status |
| POST | `/allocations/:id/cancel` | donor, NGO or A | `{ reason }`. Releases quantity and unwinds the request/offer (only before pickup) |
| GET | `/billing/fee-estimate` | any | `?unit&quantity`. Base, tax, total and the estimate note |

## 6. Workflow B: NGO assistance requests and donor offers

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/assistance-requests` | N | `{ categoryId, dietaryRequirement 'VEG_ONLY'\|'ANY', quantityRequired, unit, neededFrom, neededUntil, location?, address?, urgency LOW\|MEDIUM\|HIGH\|CRITICAL, beneficiariesCount, reason?, additionalRequirements? }` |
| GET | `/assistance-requests` | any | NGO: own; donor: open requests (`distanceKm`); admin: all |
| GET | `/assistance-requests/:id` | owner NGO, donor (open or offered), A | Includes `offers` (a donor sees only their own) |
| PATCH | `/assistance-requests/:id` | N owner | `{ version, … }`. Quantity cannot drop below the committed quantity |
| POST | `/assistance-requests/:id/cancel` | N owner, A | `{ reason }`. Rejects pending offers and releases reserved food |
| POST | `/assistance-requests/:id/offers` | D | `{ quantity, foodName, dietaryType, pickupAvailableFrom, pickupDeadline, location?, address?, notes?, readyFood?: { preparedAt, storageType, safetyConfirmed: true } }` |
| GET | `/assistance-requests/:id/offers` | as above | |
| POST | `/assistance-requests/:id/respond` | D | `{ response: 'DECLINED'\|'UNAVAILABLE' }` (recorded on the match recommendation) |
| GET | `/offers/mine` | D | |
| PATCH | `/offers/:id/accept` | N owner | `{ quantity? }`. Under a request row lock, capped at the remaining need. Ready food is reserved immediately. Returns `feeEstimate` |
| PATCH | `/offers/:id/reject` | N owner | `{ reason? }` |
| PATCH | `/offers/:id/confirm` | D owner | `{ confirmedQuantity ≤ accepted, preparedAt, storageType, safetyConfirmed: true }`. Creates the actual donation and allocation; a shortfall re-opens the request |
| POST | `/offers/:id/cancel` | D owner | `{ reason }`. Returns the committed quantity to the request |

## 7. Matching and allocation optimisation

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/matching/ngos?donationId=` | D owner, A | Latest run: `rankingStatus` (`RANKED` / `RANKING_UNAVAILABLE` / `NO_ELIGIBLE_CANDIDATES` / `NOT_RUN`) and items with `eligible`, `score`, `rank`, `criteria` (8 weighted criteria), `explanation`, `limitations`, `ineligibilityReasons`, `distanceKm` and `distanceSource` |
| GET | `/matching/donors?requestId=` | N owner, A | The same, for donors |
| GET | `/matching/donations` | NM | Donations recommended to this NGO |
| GET | `/matching/assistance-requests` | D | Requests recommended to this donor |
| POST | `/matching/refresh` | owner, A | `{ donationId }` or `{ requestId }`. Re-runs matching (deduplicated notifications) |
| POST | `/matching/allocate` | D or N | `{ donationId }` (split across pending requests) or `{ assistanceRequestId }` (which offers to accept). `source` is `AI_OPTIMIZER` or `FALLBACK_FIRST_COME`. A **proposal only**: execution goes through approve-batch or accept |

## 8. Representatives, pickups, verification and handover

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| GET / POST | `/ngos/me/representatives` | N | POST `{ self: true, phone, idDocumentType, idDocumentLast4 }`, or `{ fullName, email, phone, idDocumentType, idDocumentLast4 }` → returns `inviteUrl` (single use, 72 h) |
| PATCH | `/ngos/me/representatives/:id` | N | `{ status: ACTIVE\|INACTIVE\|REVOKED }`. Deactivating revokes outstanding QR passes |
| PUT | `/ngos/me/representatives/:id/photo` | N | multipart `file` (JPEG/PNG) |
| GET | `/representatives/:id/photo` | NGO, the representative, A, or the donor of an active pickup | |
| POST | `/pickups/assign` | N | `{ allocationId, representativeId, scheduledPickupAt?, destination? }`. Reassignment is allowed before verification |
| GET | `/pickups` · `/pickups/:id` | donor, NGO, the representative, A | Detail includes `checks` (`{ qrVerifiedAt, identityConfirmedAt }`), `handover`, `delivery` and `trackingSessions` |
| POST | `/pickups/generate-pass` | the assigned representative | `{ pickupId }` → `{ token, qrPayload, expiresAt }`. An opaque single-use token (no personal data); a new pass revokes the previous one |
| POST | `/pickups/verify-qr` | D (rate-limited: 30 requests / 15 min per user) | `{ token }` (the scanned, typed or pasted pass code) → `{ pickup }`, whose representative details (photo, name, ID type and last 4) are used for the ID check. The pass is consumed atomically. Every rejection is logged. `422 QR_REJECTED` with `details.reason` ∈ `TOKEN_NOT_FOUND, TOKEN_EXPIRED, TOKEN_CONSUMED, TOKEN_REVOKED, WRONG_DONOR, REPRESENTATIVE_INACTIVE, PICKUP_NOT_ACTIVE` |
| POST | `/pickups/confirm-identity` | D | `{ pickupId }`. The donor confirms the photo-ID check; the pickup moves from `ASSIGNED`/`EN_ROUTE` to `VERIFIED`. `409 VERIFICATION_INCOMPLETE` if the QR pass has not been verified; `403 REPRESENTATIVE_INACTIVE` if the representative is no longer active |
| POST | `/pickups/confirm-handover` | D or NGO side | `{ pickupId, quantity, notes? }` → `outcome` is `WAITING`, `CONFIRMED` (points and fee recorded) or `DISPUTED` |
| POST | `/pickups/:id/report-failure` | donor or NGO | `{ reason }`. A no-show; the reservation is kept for reassignment |
| POST | `/pickups/:id/confirm-delivery` | NM | `{ deliveredQuantity, beneficiariesServed?, notes?, location? }` |
| GET | `/disputes` | any (scoped) | Includes `unit`, both confirmed quantities and the allocated quantity. Resolution notifications link each party to its pickup |

## 9. LiveTrack

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tracking/start` | the assigned representative | `{ pickupId, stage: 'TO_PICKUP'\|'TO_DESTINATION', consent: true }` |
| POST | `/tracking/location` | the tracked representative (120/min) | `{ sessionId, lat, lng, accuracyM?, heading?, speedMps?, recordedAt }`. Implausible jumps and out-of-order points are ignored |
| POST | `/tracking/stop` | the representative or N | `{ sessionId, reason? }` |
| POST | `/tracking/events` | the representative | `{ sessionId? \| pickupId?, type: PERMISSION_DENIED\|POSITION_UNAVAILABLE\|DISCONNECTED\|RECONNECTED }` |
| GET | `/tracking/:sessionId` | the representative, N, the donor (pickup leg only), A (audited) | `liveness`: `LIVE`, `STALE`, `WAITING_FOR_FIRST_POSITION` or `ENDED`. `eta.etaSeconds` is null without road routing |
| GET | `/tracking/:sessionId/path` | as above | The latest ≤ 500 points |
| POST | `/tracking/:sessionId/confirm-delivery` | NM | Same as the pickup delivery confirmation |

## 10. Rewards (donors) and billing (NGOs)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/rewards/balance` | DONOR | Balance, tier, next tier, `nextRateUpgrade` and the active rules |
| GET | `/rewards/history` | DONOR | The immutable ledger with calculation lines |
| GET | `/rewards/leaderboard` | any | `?month=YYYY-MM`. Names are shown only with the donor's consent |
| GET / POST | `/rewards/certificates` | DONOR / D | POST `{ periodStart, periodEnd }` (requires verified handovers in the period) |
| GET | `/rewards/certificates/:id/pdf` | DONOR | PDF |
| GET | `/billing/summary` | NGO | Uninvoiced, outstanding and paid amounts; fee rules; tax setting; whether online payment is available |
| GET | `/billing/history` · `/billing/invoices` · `/billing/payments` | NGO, A | |
| GET | `/billing/invoices/:id/pdf` | NGO owner, A | PDF |
| POST | `/billing/payments` | N | `{ invoiceId }`. Creates a Razorpay order, or returns `503 PAYMENTS_NOT_CONFIGURED` |
| POST | `/billing/payments/verify` | N | `{ orderId, paymentId, signature }`. A verified checkout leaves the payment `PENDING` until the webhook confirms capture |
| POST | `/billing/webhooks/razorpay` | HMAC signature | Raw body; `X-Razorpay-Signature`; de-duplicated by `X-Razorpay-Event-Id` |

## 11. Forecasting, analytics, planning, assistant

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST / GET | `/donors/me/metrics` | D / DONOR | `{ date, mealPeriod, preparedQty, soldQty, surplusQty, isHoliday?, specialEvent? }`. `dataSource` is `DONOR_ENTERED` or `SYNTHETIC` |
| GET | `/predictions/surplus` | D | `?date=YYYY-MM-DD`. `status` is `OK` or `UNAVAILABLE`; each prediction is `OK` or `INSUFFICIENT_HISTORY` |
| GET | `/predictions/accuracy` | DONOR | Past forecasts compared with recorded actuals |
| GET | `/analytics/donor` · `/analytics/ngo` · `/analytics/admin` | role | Every response carries a `dataLabel` |
| GET | `/analytics/insights` | any | From the AI service, with sample-size guards. `status: UNAVAILABLE` when the service is offline |
| POST / GET | `/collection-plans` | N | POST `{ planDate, startTime, vehicleCapacity?, representativeId?, start?, end?, allocationIds (1–25) }`. Runs OR-Tools VRPTW; `solverStatus`, stops and drop reasons |
| GET | `/collection-plans/:id` · PATCH `/collection-plans/:id/status` | NM · N | `{ status: CONFIRMED\|CANCELLED\|COMPLETED }` |
| POST | `/ai/chat` | any (20/min) | `{ message, conversationId?, intent? }` → `{ conversationId, mode: LLM\|DIRECT\|FALLBACK\|UNAVAILABLE, message, cards, pendingAction }` |
| GET | `/ai/suggestions` · `/ai/conversations` · `/ai/conversations/:id/messages` | any | |
| POST | `/ai/actions/:id/confirm` · `/ai/actions/:id/cancel` | the action owner | Executes or cancels a pending state-changing action (30 min expiry) |

## 12. Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/verifications` | `?status&type`. Application queue |
| GET | `/admin/organizations/:type/:id/documents` | `type` is `donor` or `ngo` |
| PATCH | `/admin/organizations/:type/:id/verification` | `{ status: APPROVED\|REJECTED\|SUSPENDED, notes }` (notes are required to reject). Suspending revokes sessions |
| PATCH | `/admin/verification-documents/:id` | `{ status: ACCEPTED\|REJECTED, notes? }` |
| GET / PATCH | `/admin/users` · `/admin/users/:id/status` | `{ status: ACTIVE\|SUSPENDED, reason? }` (you cannot change your own account) |
| GET / PUT | `/admin/settings` · `/admin/settings/:key` | `{ value }`, validated per key (for example `matching.weights` must sum to 100; `billing.tax`) |
| GET | `/admin/audit-logs` | `?action&entityType&entityId&actorUserId` |
| GET / POST | `/admin/jobs` · `/admin/jobs/:id/retry` | DEAD jobs and retry |
| GET | `/admin/notification-deliveries` | Email delivery statuses |
| GET | `/admin/verification-logs` | QR pass and identity-check attempt log |
| PATCH | `/admin/disputes/:id/resolve` | `{ outcome: CONFIRM_QUANTITY\|CANCEL_COLLECTION, resolvedQuantity?, resolution }` |
| GET | `/admin/tracking/active` | Active sessions (opening one is audited) |
| GET / POST / DELETE | `/admin/reward-rules` | Versioned rules (`unit`, `basis`, `points`, `lifetimeThreshold`) |
| POST | `/admin/rewards/adjust` | `{ donorId, points ±, reason }`. A new ADJUSTMENT row, never an edit |
| GET / POST | `/admin/fee-rules` | `{ unit, amountPerUnit }` |
| POST | `/admin/invoices/generate` | `{ periodStart, periodEnd }` |
| POST | `/admin/payments/manual` | `{ invoiceId, amount, reference }` (offline payments, audited) |
| GET | `/admin/ai/performance` | AI service health, model versions, live forecast accuracy, matching performance |
