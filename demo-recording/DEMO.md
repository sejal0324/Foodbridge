# FoodBridge AI: guided tour

Captured from the running app (http://localhost:5173) on 3 Nov 2026, using fresh synthetic demo data.
Every page was loaded live, signing in through the real login form. The tour only viewed pages and changed no data.

> Screenshots 10 and 31 predate the removal of the OTP step from pickup verification (4 Nov 2026), so they may still
> show the old code field and labels; their file names keep the old wording.

Open this file in VS Code and press **Ctrl+Shift+V** to see the screenshots inline.

## Public

What anyone sees before signing in.

### 1. Landing page with live impact numbers

`/`

![Landing page with live impact numbers](01-public-landing-page-with-live-impact-numbers.png)

### 2. How FoodBridge works

`/`

![How FoodBridge works](02-public-how-foodbridge-works.png)

### 3. Registration with India-wide location search

`/register`

![Registration with India-wide location search](03-public-registration-with-india-wide-location-searc.png)

## Donor

A restaurant or hotel with surplus food (Hotel Sahyadri, Pune). Listing food is free; verified handovers earn reward points.

### 4. Dashboard

`/donor`

![Dashboard](04-donor-dashboard.png)

### 5. My donations

`/donor/donations`

![My donations](05-donor-my-donations.png)

### 6. Donation detail: reservations, pickup window and map

`/donor/donations/7b88c786-dcdf-421b-b2dd-db38acee51ac`

![Donation detail: reservations, pickup window and map](06-donor-donation-detail-reservations-pickup-window-a.png)

### 7. AI-ranked NGO recommendations, each with its reasons and match score

`/donor/donations/7b88c786-dcdf-421b-b2dd-db38acee51ac`

![AI-ranked NGO recommendations, each with its reasons and match score](07-donor-ai-ranked-ngo-recommendations-each-with-its-.png)

### 8. List surplus food (free for donors)

`/donor/donations/new`

![List surplus food (free for donors)](08-donor-list-surplus-food-free-for-donors.png)

### 9. Open NGO assistance requests near me

`/donor/assistance`

![Open NGO assistance requests near me](09-donor-open-ngo-assistance-requests-near-me.png)

### 10. Pickups: verify QR pass + photo ID

`/donor/pickups`

![Pickups: verify QR pass + photo ID](10-donor-pickups-verify-qr-pass-otp-id.png)

### 11. AI surplus forecast (synthetic training data)

`/donor/forecast`

![AI surplus forecast (synthetic training data)](11-donor-ai-surplus-forecast-synthetic-training-data.png)

### 12. Rewards: 10 points per verified meal

`/donor/rewards`

![Rewards: 10 points per verified meal](12-donor-rewards-10-points-per-verified-meal.png)

### 13. Impact analytics

`/donor/analytics`

![Impact analytics](13-donor-impact-analytics.png)

### 14. AI assistant (answers from my own data)

`/donor/assistant`

![AI assistant (answers from my own data)](14-donor-ai-assistant-answers-from-my-own-data.png)

### 15. Assistant answers from real data: my reward points

`/donor/assistant`

![Assistant answers from real data: my reward points](15-donor-assistant-answers-from-real-data-my-reward-p.png)

## NGO

An NGO that collects and distributes food (Helping Hands Foundation, Pune). It pays ₹5 per meal, packet or box, and only for food actually handed over.

### 16. Dashboard

`/ngo`

![Dashboard](16-ngo-dashboard.png)

### 17. Marketplace: available food nearby

`/ngo/marketplace`

![Marketplace: available food nearby](17-ngo-marketplace-available-food-nearby.png)

### 18. Listing detail: why it was recommended (match score out of 100)

`/ngo/marketplace/7b88c786-dcdf-421b-b2dd-db38acee51ac`

![Listing detail: why it was recommended (match score out of 100)](18-ngo-listing-detail-why-it-was-recommended-match-sc.png)

### 19. Request it: the ₹5 per meal fee estimate is shown before committing

`/ngo/marketplace/7b88c786-dcdf-421b-b2dd-db38acee51ac`

![Request it: the ₹5 per meal fee estimate is shown before committing](19-ngo-request-it-the-5-per-meal-fee-estimate-is-show.png)

### 20. My assistance requests (several donors can fill one)

`/ngo/assistance`

![My assistance requests (several donors can fill one)](20-ngo-my-assistance-requests-several-donors-can-fill.png)

### 21. Post a requirement, e.g. 150 veg meals tomorrow 12–2 PM

`/ngo/assistance/new`

![Post a requirement, e.g. 150 veg meals tomorrow 12–2 PM](21-ngo-post-a-requirement-e-g-150-veg-meals-tomorrow-.png)

### 22. Collections: assign a representative, generate the QR pass

`/ngo/collections`

![Collections: assign a representative, generate the QR pass](22-ngo-collections-assign-a-representative-generate-t.png)

### 23. Authorised representatives

`/ngo/representatives`

![Authorised representatives](23-ngo-authorised-representatives.png)

### 24. Route planning (multi-stop VRPTW optimiser)

`/ngo/planning`

![Route planning (multi-stop VRPTW optimiser)](24-ngo-route-planning-multi-stop-vrptw-optimiser.png)

### 25. Billing: fees, invoices (PDF) and payments

`/ngo/billing`

![Billing: fees, invoices (PDF) and payments](25-ngo-billing-fees-invoices-pdf-and-payments.png)

### 26. NGO analytics

`/ngo/analytics`

![NGO analytics](26-ngo-ngo-analytics.png)

## Admin

The FoodBridge operations team.

### 27. Platform overview

`/admin`

![Platform overview](27-admin-platform-overview.png)

### 28. Organisation verification queue

`/admin/verifications`

![Organisation verification queue](28-admin-organisation-verification-queue.png)

### 29. Users

`/login`

![Users](29-admin-users.png)

### 30. All donations

`/login`

![All donations](30-admin-all-donations.png)

### 31. Pickups, verification log and live tracking

`/login`

![Pickups, verification log and live tracking](31-admin-pickups-qr-otp-verification-log-and-live-tra.png)

### 32. Handover disputes

`/login`

![Handover disputes](32-admin-handover-disputes.png)

### 33. Reward rules and ledger

`/login`

![Reward rules and ledger](33-admin-reward-rules-and-ledger.png)

### 34. Fees, invoices, payments and revenue

`/login`

![Fees, invoices, payments and revenue](34-admin-fees-invoices-payments-and-revenue.png)

### 35. AI performance (matching and forecasting)

`/login`

![AI performance (matching and forecasting)](35-admin-ai-performance-matching-and-forecasting.png)

### 36. Platform settings (matching weights, fees, tax)

`/login`

![Platform settings (matching weights, fees, tax)](36-admin-platform-settings-matching-weights-fees-tax.png)

### 37. Audit log

`/login`

![Audit log](37-admin-audit-log.png)

### 38. System health

`/login`

![System health](38-admin-system-health.png)
