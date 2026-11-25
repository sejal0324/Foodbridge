# FoodBridge AI — Web app

React 19 + TypeScript (strict) + Vite single-page app for donors, NGOs and administrators.
Stage 1 (this code) contains the shared foundation, the design system, the public pages,
authentication and the complete **donor** area. The **NGO** (`/ngo/*`) and **admin**
(`/admin/*`) areas are placeholders that the next stages fill in, reusing everything below.

| | |
|---|---|
| UI | React 19, Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react, own components (no UI kit) |
| Routing / data | React Router 7, TanStack Query 5, Axios |
| Forms | React Hook Form + Zod (`@hookform/resolvers/zod`) |
| Realtime | `socket.io-client` |
| Maps | Leaflet + react-leaflet with OpenStreetMap; Google Maps JS (`@vis.gl/react-google-maps`) only when a browser key is set |
| QR | `qrcode.react` (display), `@zxing/browser` (camera scan) with a manual code fallback |
| Charts | Recharts |
| Tests | Vitest, Testing Library, jsdom, user-event |

## Running it

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api and /socket.io to http://127.0.0.1:5001)
npm run typecheck  # tsc -b (strict, noUncheckedIndexedAccess)
npm run lint       # ESLint 10 flat config: typescript-eslint + react-hooks (incl. React Compiler rules)
npm test           # vitest run
npm run build      # tsc -b && vite build  → dist/
npm run preview    # serves dist/ on :4173 with the same proxy
```

The backend must be running (see the root README). Demo accounts are created by the seed
(`cd backend && npm run db:reset`), e.g. `spice.garden@demo.foodbridge.local` /
`Demo-pass-2026` (donor), `helping.hands@demo.foodbridge.local` (NGO),
`admin@foodbridge.local` / `Admin-pass-2026`.

### Configuration

Only `VITE_*` variables reach the browser (never put secrets in them). They are read from
`frontend/.env*` files (Vite's default `envDir`), not from the repository root `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | API base. Keep the default in development so the refresh cookie stays first-party through the proxy. |
| `VITE_SOCKET_URL` | same origin | Socket.IO origin (path is always `/socket.io`). |
| `VITE_GOOGLE_MAPS_BROWSER_API_KEY` | empty | When set, `<MapView>` renders Google Maps instead of OpenStreetMap. |
| `FOODBRIDGE_API_PROXY_TARGET` | `http://127.0.0.1:5001` | Dev/preview proxy target (Node-side only, not exposed). |

The backend accepts `POST /api/auth/refresh` and `/logout` only from origins in its
`CORS_ORIGINS` (default `http://localhost:5173`). Open the app as **http://localhost:5173**;
another origin (e.g. `127.0.0.1:5173` or the preview port 4173) can sign in but cannot restore
the session after a reload until it is added to `CORS_ORIGINS`.

## Structure

```
src/
  app/            App.tsx, providers.tsx, router.tsx (route map), guards.tsx
  components/
    ui/           design-system primitives (see inventory) — import from '@/components/ui'
    map/          MapView, LocationPicker
    qr/           QrDisplay, QrScanner
    charts/       ChartFrame, SimpleBarChart, ForecastChart, palette/theme
    feedback/     QueryState, FullPageLoader, RouteError, NotFoundPage
    AreaPlaceholder.tsx
  layouts/        PublicLayout, AuthLayout (+AuthCard), AppShell, Logo, navigation.ts
  features/<name>/
    api.ts        TanStack Query hooks for that domain (the only place that calls the API)
    schemas.ts    Zod form schemas + mappers to request bodies
    components/   feature components (exported for reuse where noted)
    pages/        route pages (default exports, lazy-loaded)
  hooks/          useNow, useSocketStatus/useSocketEvent, useAuthedObjectUrl, useDocumentTitle, useMediaQuery
  services/       apiClient (+ApiError), tokenStore, socket, queryClient, queryKeys, download, config
  types/          API DTO types mirroring the backend `to*Dto` mappers
  utils/          format (IST/en-IN/INR/units), labels, formErrors, cn
  styles/         index.css (Tailwind v4 theme tokens)
tests/            setup.ts, utils.tsx (renderWithProviders, mockApi)
```

Tests are co-located as `*.test.ts(x)`.

## Conventions

### Talking to the API

- Never call Axios directly from components. Add a hook to `features/<x>/api.ts` using the
  helpers from `@/services/apiClient`:
  - `apiGet<T>(url, params)` → `data`; `apiGetPage<T>(url, params)` → `{ items, meta }`;
  - `apiPost / apiPatch / apiPut / apiDelete<T>(url, body, config)` (204 → `undefined`);
  - `apiGetBlob(url)` and `downloadFile(url, fallbackName)` for authenticated files;
  - `newIdempotencyKey()` → send as `Idempotency-Key` on state-creating POSTs (one key per submit attempt).
- Every failure is an `ApiError` (`status`, `code`, `message`, `details`, `requestId`).
  `message` is user-safe. Show it with `toast.error(err)` or `<ErrorState error={err} />` (shows the requestId).
- Query keys live in `services/queryKeys.ts` (`qk`). Invalidate with the shortest prefix covering the change.
- Auth: the access token is kept **in memory only** (`tokenStore`). On start `AuthProvider`
  calls `POST /auth/refresh` (httpOnly cookie). A 401 `TOKEN_EXPIRED` triggers one shared
  ("single-flight") refresh and one retry per request; if the refresh fails the session is
  cleared and the guards send the user to `/login`. `skipAuthRefresh: true` opts a request out.
- Known backend quirk: list endpoints that compute distances must be called **with**
  `maxDistanceKm` (see "Backend issues" below).

### Forms

React Hook Form + `zodResolver(schema)`; client rules mirror `backend/src/validators/*.ts`.
Map server errors with `applyServerErrors(err, setError, { fields, fieldMap, codeMap })`
from `@/utils/formErrors`: 422 `details[{path,message}]` land on fields (`fieldMap` renames
nested backend paths, e.g. `organization.name` → `organizationName`), business codes go to a
field through `codeMap` (e.g. `{ EMAIL_TAKEN: 'email' }`), and the return value is the
form-level message (render it in a `<Banner tone="danger" live>`). Use `useWatch`, not `watch`
(React Compiler lint rule). Wrap every control in `<Field label error hint required>`; the
control picks up `id`, `aria-describedby` and `aria-invalid` automatically.

### Dates, money, units

All display formatting is in `@/utils/format` and always uses **Asia/Kolkata** and `en-IN`:
`formatDateTime`, `formatDate`, `formatTime`, `formatWindow`, `formatRelative`, `formatINR`
(`₹1,23,456.50`), `formatQuantity(40, 'MEALS')` → `40 meals` (`1 box`, `2 boxes`),
`formatDistance`, `formatDuration`. `<input type="datetime-local">` values are IST:
convert with `toIstInputValue(iso)` / `fromIstInputValue(local)` (→ `…+05:30`).

### Locations (all of India)

FoodBridge serves the whole country; never hard-code a city. `@/utils/india` holds the 28
states + 8 union territories (`INDIA_STATES_AND_UTS`, `matchIndianState` for geocoder names),
the map defaults (`INDIA_CENTER` 22.5/80.0, zoom 5, `INDIA_BOUNDS` for soft panning) and
`isWithinIndiaBounds` (the same box the backend validates). For any form that sets a location:

- use `<LocationPicker value onChange onAddressSelect fallback? />` — address search
  (`GET /api/geo/search?q=`, debounced 400 ms, ≥3 characters, India only, "Search ©
  OpenStreetMap contributors" shown for OSM results), "Use my current location" (asked only on
  click) and click-to-pick;
- pre-fill only empty fields with
  `fillEmptyAddressFields(result, { get: getValues, set: setValue })` (or `addressLineFrom`);
- use `<StateSelect {...register('state')} current={savedValue} />` for states (city is free text);
- map the backend's 422 `LOCATION_OUTSIDE_INDIA` onto the location field:
  `applyServerErrors(err, setError, { codeMap: { LOCATION_OUTSIDE_INDIA: 'location' } })`.

### Pages and states

Every page starts with `<PageHeader title description actions back meta />` (also sets the
document title) and renders loading / error / empty states — `QueryState` does all three:

```tsx
<QueryState query={query} empty={<EmptyState title="No pickups yet" />}>
  {(rows) => <PickupTable rows={rows} />}
</QueryState>
```

Features that need an **approved** organisation are wrapped in
`<ApprovalGate user={user} feature="Listing food">` (it explains the pending/rejected/suspended
state and links to the profile). `AppShell` already shows `VerificationBanner` at the top.
Hide unavailable actions with `isOrganisationApproved(user)`; the backend is still the
authority for every permission.

### Toasts

```tsx
const toast = useToast();
toast.success('Request approved', '40 meals reserved for the NGO.');
toast.error(err);              // ApiError → message + request id
toast.show({ title, description, tone: 'warning', action: { label: 'Open', onClick } });
```

### Realtime

`AppShell` mounts `useRealtime()`: one Socket.IO connection with `auth: { token }`,
re-authenticated after every token refresh; `notification:new` refreshes caches, shows a toast
and (if the user enabled it from a click) a desktop notification while the tab is hidden.
Use `useSocketEvent(event, handler)` / `useSocketStatus()` elsewhere. LiveTrack uses
`useTrackingSession(sessionId)` (REST + `tracking:join` room + polling fallback).

## Adding a page (NGO / admin stages)

1. Create `src/features/<domain>/pages/MyPage.tsx` with a default export (data via that
   feature's `api.ts` hooks).
2. Register it in the area's route module — `src/features/ngo/routes.tsx` or
   `src/features/admin/routes.tsx` (both are lazy-loaded by `src/app/router.tsx` under
   `/ngo/*` and `/admin/*`, inside the shared `AppShell`, already guarded with `RequireRole`):

   ```tsx
   const MarketplacePage = lazy(() => import('@/features/donations/pages/MarketplacePage'));
   <Route path="marketplace" element={<MarketplacePage />} />
   ```
3. Add the sidebar entry to `NGO_NAV` / `ADMIN_NAV` in `src/layouts/navigation.ts`
   (`{ label, to, icon, end?, requiresApproval? }`).
4. Shared pages: mount `NotificationsPage` (`features/notifications/pages`) and
   `AssistantPage` (`features/assistant/pages`) at `notifications` and `assistant` — they are
   role-agnostic. The bell already links to `/<role>/notifications`.
5. Use the paths the backend puts in notification links: NGO `/ngo/assistance/:id`,
   `/ngo/pickups/:id`, `/ngo/marketplace/:id`, `/ngo/requests`, `/ngo/collections`,
   `/ngo/billing`, `/ngo/profile`, `/ngo/analytics`, `/ngo/planning`; admin `/admin/disputes`,
   `/admin/verifications`, `/admin/analytics`, `/admin/pickups`, `/admin/ai`.

## Shared component inventory

**`@/components/ui`** — `Button` (variants primary/secondary/outline/ghost/danger/link, sizes,
`loading`, icons), `ButtonLink`, `Input`, `Textarea`, `Select` (`options`, `placeholder`),
`Checkbox`, `Switch`, `Field`, `FieldSet`, `Card`/`CardHeader`/`CardBody`/`CardFooter`, `Badge`,
`StatusBadge` (colour + label for every backend status; `STATUS_STYLES`), `Dialog`,
`ConfirmDialog`, `Tabs`/`TabPanel`, `DataTable` (table on desktop, cards on mobile),
`EmptyState`, `ErrorState` (shows requestId), `LoadingState`, `Skeleton`, `SkeletonList`,
`Pagination`, `StatCard`, `PageHeader`, `Banner` (info/warning/danger/success/demo),
`Countdown`, `QuantityBadge`, `DistanceLabel` (always says "straight-line estimate" unless
`distanceSource === 'ROAD_GOOGLE_ROUTES'`), `ProgressBar`, `DescriptionList`, `Avatar`,
`Popover`, `Spinner`, toasts (`ToastProvider`, `useToast`).

**Maps** — `<MapView ariaLabel markers path onPick picked fitToContent height />` (markers:
`{ id, position, kind: 'pickup'|'destination'|'representative'|'donor'|'ngo'|'selected'|'stale', label, title }`).
With nothing to show it opens on India (zoom 5); with markers/paths it fits to them (padding,
max zoom 15) and re-fits only when content leaves the view; panning is softly limited to India;
OSM attribution included. `<LocationPicker />` adds address search, "Use my current location",
click-to-pick and an accessible coordinate read-out (see "Locations" above).
`<StateSelect />` lives in `@/components/ui`.

**QR** — `<QrDisplay value label />` (representative pass) and `<QrScanner onResult busy />`
(camera via ZXing + manual paste/type fallback, handles denied/missing camera).

**Charts** (`@/components/charts`) — `ChartFrame` (title, legend for ≥2 series, chart/table
toggle), `SimpleBarChart` (vertical/horizontal), `ForecastChart` (history + estimate + range
band), `SERIES_COLOURS` (validated for the dark surface; use slots in order), `FORECAST_COLOURS`.

**Domain components**
- Matching (`@/features/matching`): `RecommendationCard` (score, explanation, limitations,
  ineligibility reasons, expandable `CriteriaBreakdown`), `RankingStatusBanner`
  ("AI ranking unavailable — ordered by distance"), hooks for NGO/donor/donation/request recommendations, `useAllocationProposal`.
- Tracking (`@/features/tracking`): `TrackingViewer` (map, path, destination, ETA, liveness),
  `LivenessBadge`, `EtaSummary`, `effectiveLiveness` (stale is never shown as live).
- Pickups: `RepresentativeCard`, `VerificationStepper`, QR rejection copy (`qrRejectionCopy`),
  `deriveVerificationStep`; `VerificationFlow` is the donor-side flow.
- Notifications (`@/features/notifications`): `NotificationBell`, `NotificationItem`,
  `NotificationPreferencesCard`, `NotificationsPage`, `useRealtime`.
- Assistant (`@/features/assistant`): `AssistantPanel role`, `AssistantPage`,
  `ResultCard` (generic list / key-value / recommendation renderers with in-app links),
  `PendingActionCard` (confirm/cancel), `resolveAssistantLink`.
- Billing: `FeeEstimateCard unit quantity` (base, tax, total + backend note).
- Assistance: `AssistanceRequestCard`, `UrgencyBadge`, `OfferActions`.
- Donations: `DonationsTable`, `StatusTimeline`, `RecommendedNgosPanel`.
- Profile: `VerificationBanner`, `ApprovalGate`, `DocumentsCard organisationType`,
  `ChangePasswordCard`.
- Analytics: `InsightsPanel` (sample size, confidence, limitations, UNAVAILABLE),
  `useRoleAnalytics(role)` (drives the "Demo data" pill).

## Testing

`tests/utils.tsx` provides `renderWithProviders(ui, { route, auth })` (QueryClient, toasts,
router, a fake `AuthContext`) and `mockApi(handler)`, which swaps the Axios adapters for a
fake backend (`ok(data)`, `apiError(status, code, message, details)`) so components exercise
the real client, interceptors and hooks.

## Backend issues found while integrating

- `GET /api/assistance-requests` as a **donor** (scope `open`, the default) returns **500**
  unless `maxDistanceKm` is sent: the count query passes the donor's lng/lat parameters that
  its WHERE clause does not use (`could not determine data type of parameter $1` /
  `bind message supplies 2 parameters…`, `AssistanceService.list`). The donor UI always sends
  `maxDistanceKm`.
- `GET /api/donations` as an **NGO** (scope `marketplace`) has the same bug
  (`DonationService.list`): send `maxDistanceKm`.
- A confirmed handover ends the `TO_PICKUP` tracking session with a direct SQL update, so no
  `tracking:ended` socket event is emitted; the viewer refetches when the pickup changes.
