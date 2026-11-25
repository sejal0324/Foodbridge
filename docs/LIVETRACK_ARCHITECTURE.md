# LiveTrack Architecture

Foreground, consent-based location sharing for two legs of a collection.
Implementation: [`tracking.service.ts`](../backend/src/services/tracking.service.ts),
[`sockets/gateway.ts`](../backend/src/sockets/gateway.ts) and [`integrations/maps.ts`](../backend/src/integrations/maps.ts).

| Stage | Who shares | Who can view |
|---|---|---|
| `TO_PICKUP`: representative travelling to the donor | The assigned representative | The representative, the NGO owner, **the donor**, admins (audited) |
| `TO_DESTINATION`: food travelling to the NGO/destination | The assigned representative | The representative, the NGO owner, admins (audited). Not the donor |

## Flow

1. The representative starts tracking with `consent: true` (the UI shows a consent dialog; the browser then shows its own
   permission prompt). If permission is denied, a `PERMISSION_DENIED` event is recorded and the UI explains the limitation.
2. The browser's `watchPosition` posts `{lat, lng, accuracyM, heading, speedMps, recordedAt}` to `POST /tracking/location`.
3. The backend validates the request: the session is `ACTIVE`, the caller is the tracked user, the accuracy is at most 5 km,
   the timestamp is plausible, and the jump is plausible (≤ 70 m/s). It **persists the point first**, updates the session's
   last position and distance, then broadcasts `tracking:location` to the room `tracking:{sessionId}`.
4. Viewers join the room with `socket.emit('tracking:join', {sessionId})`, which runs the same authorisation as REST. The UI
   also polls as a fallback.
5. Tracking ends on `stop`, a confirmed handover (pickup leg), a confirmed delivery, a cancellation or reassignment, or after
   12 hours of silence (`EXPIRED`).

## Liveness: stale data is never shown as live

`GET /tracking/:id` returns one of:

| `liveness` | Meaning |
|---|---|
| `LIVE` | Last position younger than `tracking.stale_after_seconds` (default 60 s) |
| `STALE` | Older; the UI shows "last seen N min ago" with the timestamp |
| `WAITING_FOR_FIRST_POSITION` | Started, no position yet |
| `ENDED` | The session is over |

## Distance and ETA

- With `GOOGLE_MAPS_SERVER_API_KEY` set, the remaining distance and a traffic-aware ETA come from Google Routes
  (`source: ROAD_GOOGLE_ROUTES`, cached for 60 s per session).
- Without it, or when the API fails: the straight-line distance is labelled `STRAIGHT_LINE_ESTIMATE` and
  **`etaSeconds` is `null`** (no invented ETA).

## Privacy and retention

- Tracking only happens during an authorised journey, only after explicit consent, and only in the foreground (a normal
  browser cannot reliably track in the background; see below).
- Locations are never public. Admin views are recorded (`ADMIN_VIEWED` event plus audit log).
- Raw points are deleted `LOCATION_RETENTION_DAYS` (default 30) after the session ends; the session keeps only a distance
  summary, and its last position is cleared. The `purge-location-history` job runs hourly.
- GPS accuracy and timestamps are stored with every point.

## Future: mobile background tracking

Reliable background tracking needs a native app (Android foreground service or iOS significant-location /
background modes), batched uploads and battery-aware sampling. The API already accepts out-of-band `recordedAt`
values (within 15 minutes) and ignores out-of-order points, so a mobile client can reuse it.
