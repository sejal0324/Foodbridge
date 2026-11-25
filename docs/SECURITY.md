# Security

How FoodBridge AI protects accounts, data, money and the physical handover of food. Controls are listed with
where they are implemented and how they are tested.

## 1. Authentication and sessions

| Control | Implementation | Tested in |
|---|---|---|
| Password hashing | Argon2id (19 MiB, t=2, p=1). Timing is equalised for unknown emails | `auth.test.ts` |
| Password policy | 10–128 characters, with a letter and a digit | `auth.test.ts` |
| Access tokens | HS256 JWT, 15 min, `iss`/`aud`/`sub`/`sid`/`role`. Kept in memory in the browser | `auth.test.ts` (tampered, expired) |
| Per-request checks | The session must be unrevoked and unexpired and the account ACTIVE, looked up in the database on **every** request, so logout and suspension apply immediately | `auth.test.ts` |
| Refresh tokens | 256-bit random value, stored as SHA-256, rotated on every use, httpOnly + SameSite=Strict + Secure (production) cookie scoped to `/api/auth`. **Reuse of a rotated token revokes the whole token family** | `auth.test.ts` |
| CSRF | API calls use the bearer header; cookie endpoints also check `Origin` against the allow-list | `auth.test.ts` |
| Brute force | Login rate limit (10 per 15 min per IP + email) and account lock after 5 and 10 failures | `auth.test.ts`, `integrations.test.ts` |
| Account enumeration | Generic login errors; password-reset requests always return 202 | `auth.test.ts` |
| Single-use links | Invitations (72 h) and password resets (1 h) are hashed and consumed atomically | `auth.test.ts`, `pickup.test.ts` |
| Admin accounts | Created only server-side (`npm run admin:create`). The registration schema has no admin option, and a client-sent `role` is ignored | `auth.test.ts` |

## 2. Authorisation

- Role guards on every route (`routes/index.ts`), **plus ownership checks in services**: for example, a donor can approve
  only requests on their own donations, and only the assigned representative can generate a pass or publish locations.
- Unauthorised access to someone else's resource returns **404**, so its existence is not revealed.
- Unverified organisations cannot transact (`ORGANISATION_NOT_APPROVED`). Representatives cannot manage NGO-level resources.
- The AI assistant executes tools only from the signed-in user's role-filtered list, with that user's identity. Unknown
  tools are refused, and state changes require explicit confirmation (`intelligence.test.ts`).
- The AI service has no database access and requires a shared internal token, compared in constant time.

## 3. Input, output and transport

- Every request body, query and route parameter is validated with Zod (strict objects, numeric bounds, enums);
  errors return 422 with field details.
- SQL is always parameterised. Dynamic column lists come only from server-side allow-lists.
- Body limits: JSON 200 KB, webhooks 100 KB, uploads 10 MB with one file. Upload types are detected from **file
  signatures**, not names or headers; files are stored outside any web root and served only through authorised
  endpoints with `nosniff` and `no-store`.
- `helmet` security headers. CORS uses an explicit allow-list (no `*` in production). `x-powered-by` is disabled.
  nginx adds a CSP, frame denial and a permissions policy.
- Notification links must be relative paths (a database CHECK rejects `//host` and `/\host` open redirects).

## 4. Pickup verification, payments and location

- QR: an opaque 256-bit token stored hashed, short-lived, single use, owner-bound, revocable; every attempt is logged.
  Identity: only after a verified QR pass does the donor's photo-ID check (photo, name, ID type and last 4) move the
  pickup to `VERIFIED`; an inactive representative is refused at that step and at handover. See
  [PICKUP_VERIFICATION.md](PICKUP_VERIFICATION.md).
- Payments: success is recorded only from a signature-verified (HMAC-SHA256) Razorpay webhook with a matching amount,
  de-duplicated by event id. Card data never touches FoodBridge ([NGO_BILLING.md](NGO_BILLING.md)).
- Location: consent-based, foreground only, viewers authorised, admin views audited, raw points purged after 30 days
  ([LIVETRACK_ARCHITECTURE.md](LIVETRACK_ARCHITECTURE.md)).

## 5. Data integrity

- Database constraints are the last line of defence:
  - `reserved_quantity <= quantity` and `quantity_committed <= quantity_required` (over-allocation is impossible).
  - Unique source references on allocations (no double approval).
  - Partial unique indexes (one live request or offer).
  - The handover `CONFIRMED` requires equal quantities.
  - Unique idempotency keys for rewards and fees.
- Concurrency: row locks in a fixed order plus conditional updates. Verified by parallel-request tests (scenario D).
- Append-only tables (trigger-enforced): `audit_logs`, `reward_transactions`, `donation_status_history`,
  `assistance_request_history`, `pickup_verifications`.
- Every important state change writes an audit log row in the same transaction (actor, role, IP, user agent,
  request id and redacted changes).

## 6. Secrets and logging

- All credentials come from environment variables; `.env` is gitignored. `.env.example` contains placeholders only.
- Startup refuses: missing or short secrets, placeholder values, `EMAIL_PROVIDER=log` in production, insecure cookies
  in production, wildcard CORS, and a test run against a non-`_test` database.
- pino redaction removes authorization headers, cookies, passwords, tokens, codes, signatures and API keys from logs.
  Audit payloads are redacted by key name.

## 7. Dependencies

- `npm audit --omit=dev` (backend) reports 3 **moderate** advisories in `glob`/`minimatch` pulled in by `node-pg-migrate`.
  They affect glob-pattern handling in the migration CLI, which runs only with developer-controlled patterns and never on
  request data; the fix requires a breaking downgrade. Accepted risk; re-check on upgrade.
- Exact version pins for Python and Node runtime dependencies, plus lockfiles.

## 8. Known limitations and production checklist

- Rate limiting is in-memory per instance (QR passes stay single use and expiring across instances because that is
  enforced in the database), but use a shared store before running several backend instances (and the Socket.IO Postgres adapter).
- Uploaded files use local disk; use private object storage with encryption at rest in production.
- Access-token revocation is immediate (session check per request); the JWT secret should be rotated periodically.
- Use separate database roles: a migration owner, and an application role with no `UPDATE`/`DELETE` on append-only tables.
- Enable HTTPS everywhere (cookies become Secure automatically in production) and set `TRUST_PROXY=true` behind a proxy.
- Configure SMTP, Razorpay webhooks and a GST review before go-live.
- Lock ordering differs between the assistance service (request → offer → donation) and the pickup service
  (donation → offer). A rare concurrent "withdraw offer" plus "cancel allocation" can deadlock; PostgreSQL detects it and
  the API returns a retryable `409 CONCURRENT_UPDATE` (no corruption). A single global lock order is future work.
- An online payment captured after an invoice was already settled is recorded (the money really arrived), flagged
  `OVERPAYMENT` and announced to admins; the refund itself is manual.

The findings of the independent backend review (2026-11-03) and their fixes are listed in
[TESTING_REPORT.md](TESTING_REPORT.md#bugs-found-and-fixed-in-this-round).
