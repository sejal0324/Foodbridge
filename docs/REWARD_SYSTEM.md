# FoodBridge Rewards

Donors never pay. They earn recognition points for food that actually reached an NGO.
Implementation: [`domain/rewards.ts`](../backend/src/domain/rewards.ts) (pure calculation) and
[`services/reward.service.ts`](../backend/src/services/reward.service.ts) (ledger).

## Confirmed business rules (2026-11-03)

| Unit | Rule |
|---|---|
| **MEALS** | **10 points per verified meal.** After the donor's **lifetime** verified meals pass **500**, each further meal earns **15 points** (1.5×). A handover that crosses 500 is **split** |
| **PACKETS** | **10 points per verified order** (one handover), regardless of how many packets |
| **BOXES** | **10 points per verified order**, regardless of how many boxes |

Examples:

| Situation | Points |
|---|---|
| 7 meals, new donor | 70 |
| 40 meals, new donor | 400 |
| 40 meals; donor already has 480 lifetime meals | 20 × 10 + 20 × 15 = **500** |
| 10 meals at 1,200 lifetime meals | 150 |
| 250 packets in one handover | 10 |

Packets and boxes do not count towards the 500-meal threshold.

## Integrity rules

- Points are credited **only** from a two-way **confirmed** handover, using the **confirmed** quantity. Requested,
  offered or allocated quantities never earn points. Disputed handovers earn nothing until an admin resolves them.
- The credit is written in the same database transaction as the handover confirmation.
- **Idempotent:** `idempotency_key = handover:{id}:credit` is unique, and so is `(reference_type, reference_id, type)`.
  A retried call returns the existing credit and does not touch the balance.
- **Serialised per donor:** the donor's `reward_balances` row is locked (`FOR UPDATE`) while the credit is computed,
  so concurrent handovers split the 500-meal bracket correctly.
- **Immutable ledger:** `reward_transactions` has a trigger that rejects `UPDATE`/`DELETE`. Corrections are new
  `ADJUSTMENT` or `REVERSAL` rows (admin, with a reason, audited); a balance can never go negative.
- Each transaction stores its `calculation` (the bracket lines), so every number is explainable.

## Configurable rules

Rules are data in `reward_rules` (`unit`, `basis` = `PER_UNIT` or `PER_ORDER`, `points`, `lifetime_threshold`,
effective dates). `PER_UNIT` rules for a unit form progressive brackets over lifetime quantity. Admins change rules
with `POST /api/admin/reward-rules`: the previous version is closed (`effective_to`) and kept for history. No code
change is needed.

## Tiers and recognition (non-monetary)

| Tier | Lifetime points (initial, configurable) |
|---|---|
| Bronze | 0 |
| Silver | 2,000 |
| Gold | 10,000 |
| Platinum | 30,000 |

Other recognition features:
- **Monthly leaderboard.** Donor names are shown only if the donor opted in (`publicRecognitionConsent`); others appear as "Anonymous donor".
- **Impact certificates** (PDF) for a period, numbered `FB-CERT-YYYY-NNNNNN` and backed by the ledger.
- Achievement badges in the UI come from tiers.
