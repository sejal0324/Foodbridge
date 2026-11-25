# FoodBridge AI: Product Overview

**Predict. Match. Redistribute.**

FoodBridge AI connects surplus food from restaurants, hotels, caterers and other food businesses **across India** with
verified NGOs that feed people, and makes sure the food actually reaches them. Any city, town or district in India can use
it: matching is local to each NGO's collection radius, and maps and address search cover the whole country.

## The problem

Food businesses regularly end up with good food at the end of service, while NGOs struggle to source enough meals at
the right time and place. Informal coordination (phone calls, messaging groups) fails because:
- nobody knows who needs what, where and by when;
- food is promised twice;
- collectors cannot be verified;
- nothing is measured.

## How FoodBridge works

**Two-way discovery.**
- **Donor-initiated:** a donor lists actual surplus food. FoodBridge finds eligible NGOs, ranks them with an explainable
  weighted model and notifies the best matches. NGOs request; the donor approves, fully or partially.
- **NGO-initiated:** an NGO posts a real requirement (for example "150 vegetarian meals tomorrow, 12–2 PM, Hinjewadi").
  FoodBridge finds suitable donors using distance, the categories they produce, available food, historical surplus,
  AI-forecast surplus and opening hours, and notifies them. Several donors can each offer part of the requirement
  until it is fulfilled.

**Verified collection.** The NGO assigns an authorised representative. At pickup the donor scans the representative's
single-use QR pass and checks their photo, name and ID. Both sides confirm the quantity
handed over; a mismatch is flagged for review.

**LiveTrack.** With consent, the representative shares their location in the browser on the way to the donor and while
taking the food to its destination. Viewers always see how fresh the position is.

**Rewards and fees.**
- Donors never pay. They earn 10 points per verified meal (15 after 500 lifetime meals) and 10 points per verified
  packet or box order, plus tiers, a leaderboard and impact certificates.
- NGOs pay a transparent ₹5 per successfully redistributed unit, shown before they commit and charged only after a
  verified handover.

**Intelligence.**
- A surplus forecast per restaurant (scikit-learn, trained on clearly labelled synthetic data until real history exists).
- Explainable matching.
- OR-Tools allocation and multi-stop route planning.
- An LLM assistant that can only use the signed-in user's authorised data and never acts without confirmation.
- Analytics and data-driven insights with sample-size guards.

## Roles

| Role | Highlights |
|---|---|
| **Donor** | List donations, approve requests, respond to NGO needs, verify pickups, track collectors, rewards and certificates, forecasts, analytics, assistant |
| **NGO** | Marketplace and recommendations, assistance requests, accept offers, representatives, QR pass, LiveTrack, delivery confirmation, route planning, billing and invoices, analytics, assistant |
| **Admin** | Verification queue, users, monitoring (donations, requests, pickups, QR logs, tracking, disputes), rewards and fee configuration, invoices and payments, AI performance, platform settings, audit logs, job health |

## Principles

- **Real functionality.** No fake data or fake success messages. When an integration is not configured, the product says so.
- **Humans decide.** AI recommends; people confirm. FoodBridge never certifies food safety.
- **Integrity first.** No over-allocation, no double rewards, no double billing, immutable ledgers and audit trails.
- **Honest data.** Synthetic data, straight-line estimates and stale positions are always labelled.

See [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) and [USER_GUIDE.md](USER_GUIDE.md).
