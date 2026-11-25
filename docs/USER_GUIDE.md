# FoodBridge AI: User Guide

FoodBridge AI works **across India**. Donors list surplus food for free; verified NGOs request it, collect it with
authorised representatives, and pay a small service fee per verified unit. Every screen works on desktop and mobile.

> **Local demo (development only):** donor and NGO accounts use the password `Demo-pass-2026`.
> - Donors: `spice.garden@demo.foodbridge.local` (Pune), `delhi.donor@demo.foodbridge.local` and the other `<city>.donor@…` accounts.
> - NGOs: `helping.hands@demo.foodbridge.local` (Pune; the owner is also a representative), `delhi.ngo@demo.foodbridge.local`, …
> - Admin: `admin@foodbridge.local` / `Admin-pass-2026`.
> - Cities: Pune, Delhi, Mumbai, Bengaluru, Hyderabad, Chennai, Kolkata, Ahmedabad, Jaipur, Lucknow.
>
> Demo organisations and records are synthetic and labelled as demo data.

---

## 1. Getting started

1. **Register** (`/register`): choose **Donor** (restaurant, hotel, caterer, cafeteria, food business) or **NGO**.
   - Enter your organisation details.
   - Find your location with the **address search** (any place in India) or **Use my current location**, or click the map.
   - Choose your **state** from the list.
2. **Verification:** FoodBridge staff verify every organisation.
   - Upload documents (FSSAI or business licence, NGO registration) under **Profile & settings → Verification documents**.
   - Until you are approved you can complete your profile, but you cannot list or request food.
3. **Sign in** (`/login`). Sessions stay signed in securely. Use **Forgot password** if you need to; the reset link is single-use and valid for one hour.

## 2. Donors

| Task | Where | Notes |
|---|---|---|
| List surplus food | **Donations → New donation** | Food name, category, veg or non-veg, **whole-number quantity** in meals, packets or boxes, prepared time, storage, pickup window and pickup location. You must confirm the food is fit to eat: **FoodBridge does not certify food safety**. Warnings (for example a long time since preparation) are shown, but the decision is yours. Save as a draft or publish |
| See which NGOs fit | Donation page → **Recommended NGOs** | Ranked by an explainable score: distance, need, capacity, food handling, urgency, pickup feasibility, reliability and beneficiaries. Each card says why, and what the limitations are (for example "straight-line distance estimate"). If the AI service is offline, NGOs are listed by distance and this is clearly labelled |
| Approve requests | Donation page → **Requests** | Approve fully or partly, or reject. **Suggest split** proposes how to divide food between several NGOs; you review it, then approve. Food can never be promised twice |
| Help an NGO's request | **NGO requests** | Requests near you that match your food. Offer all or part of the quantity, or decline or mark yourself unavailable. A forecast is **not** a donation: when food is ready, **confirm the actual quantity** for an accepted offer |
| Verify the collector | **Pickups → pickup** | 1) Scan the representative's QR pass (or type or paste its code). 2) Check the photo, name, ID type and the last 4 digits of their ID. 3) Tick "I checked the ID". 4) Confirm the quantity handed over. Never hand over food if anything does not match; report a no-show instead |
| Watch the collector arrive | Pickup page → **LiveTrack** | Live position with "last updated" time. **Stale** positions are labelled; the ETA shows only when road routing is configured |
| Rewards | **Rewards** | 10 points per verified meal; 15 per meal after 500 lifetime meals; 10 points per verified packet or box order. Points come only from handovers both sides confirmed. Tiers, monthly leaderboard (your name appears only with consent) and downloadable impact certificates |
| Forecast | **Forecast & records** | Record daily prepared, sold and surplus quantities; see the AI surplus forecast with its range, and its accuracy over time |
| Analytics, assistant, notifications | Sidebar | The assistant answers from your own data only |

## 3. NGOs

| Task | Where | Notes |
|---|---|---|
| Set preferences | **Profile & settings** | Location, veg/non-veg acceptance, food categories, daily capacity, **collection radius**, beneficiaries, refrigeration, vehicle capacity. These decide which food you are matched with |
| Find food | **Marketplace** | Available donations near you, as a list or on the map of India, plus **Recommended for you**. Request a quantity. The **service fee estimate** (₹5 per meal, packet or box) is shown before you submit |
| Ask for food | **Assistance requests → New** | "150 vegetarian meals tomorrow 12–2 PM": matching donors are notified. Accept offers fully or partly (the fee estimate is shown first). Several donors can fill one request. **Suggest offers** proposes the best combination |
| Representatives | **Representatives** | Add yourself, or invite a person (they receive a single-use link to set a password). Only the last 4 digits of their ID are stored. Deactivating a representative revokes their passes immediately |
| Assign a pickup | **Collections** | Choose the representative for each reserved collection |
| At pickup (representative) | **Pickups → pickup** | Show the **QR pass** (it expires; a new pass replaces the old one). Share live location after consenting (foreground only; tracking stops when the journey ends). Show your photo ID to the donor. Confirm the quantity received; a mismatch is reviewed by FoodBridge and nothing is charged until it is resolved |
| Delivery | Pickup page | Track the trip to your kitchen or shelter, then **confirm delivery** with beneficiaries served |
| Plan routes | **Route planning** | Combine several reserved pickups: FoodBridge orders the stops within time windows and vehicle capacity. Stops that cannot fit are listed with the reason. Travel times are labelled as estimates unless road routing is configured |
| Billing | **Billing** | Fees are recorded only after a confirmed handover, using the confirmed quantity. Nothing is charged for cancelled or failed collections. Download invoice PDFs. Pay online when Razorpay is configured; otherwise pay by bank transfer and the admin records it |

## 4. Administrators

| Task | Where |
|---|---|
| Approve, reject or suspend organisations; review documents | **Verifications** |
| Suspend or reactivate users (takes effect immediately) | **Users** |
| Monitor donations, requests, pickups, verification attempts and live tracking (views are audited) | **Donations**, **Assistance**, **Pickups** |
| Resolve quantity disputes (confirm an agreed quantity, or cancel with no points and no fee) | **Disputes** |
| Reward rules and adjustments; fee rules, GST setting, invoices, manual payments | **Rewards**, **Billing** |
| AI service and model status, forecast accuracy, matching performance, insights | **AI performance** |
| Matching weights and operational policies (validated, audited) | **Settings** |
| Audit trail, background jobs, email deliveries, integration status | **Audit logs**, **System health** |

Create additional admins only from the server: `npm run admin:create -- --email … --name "…"`.

## 5. The AI assistant

Ask in plain language: "Which NGOs can collect my remaining meals?", "Find vegetarian donations within 5 km",
"What is my service fee?", "Show pending verification applications".
- It can only use **your** data, through the same permissions as the app.
- It never changes anything without your confirmation: when it drafts an assistance request, you review and confirm it.
- When the AI is unavailable, the suggested questions still return real results directly.

## 6. Good to know

- **Distances** are straight-line estimates unless marked as road distance. **Forecasts** are estimates, not donations.
- **Food safety** decisions always rest with people; FoodBridge only flags missing information.
