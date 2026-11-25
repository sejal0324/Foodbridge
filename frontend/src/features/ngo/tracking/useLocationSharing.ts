import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketEvent } from '@/hooks/useSocket';
import { ApiError } from '@/services/apiError';
import { qk } from '@/services/queryKeys';
import type { TrackingSessionView } from '@/types';
import { trackingApi } from '../api';
import type { LocationInput, TrackingStage } from '../types';
import { distanceMeters } from '../utils';

/** Send at most one position every 10 s, unless the representative moved at least 25 m. */
export const SEND_INTERVAL_MS = 10_000;
export const SEND_DISTANCE_M = 25;
/** The backend refuses positions less accurate than 5 km (422 ACCURACY_TOO_LOW). */
export const MAX_ACCURACY_M = 5_000;

export interface PositionSample {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  time: number;
}

/** Throttle rule for LiveTrack uploads (pure, unit-tested). */
export function shouldSend(last: PositionSample | null, next: PositionSample, intervalMs = SEND_INTERVAL_MS, distanceM = SEND_DISTANCE_M): boolean {
  if (!last) return true;
  if (next.time - last.time >= intervalMs) return true;
  return distanceMeters(last, next) >= distanceM;
}

export type SharingStatus = 'idle' | 'starting' | 'waiting' | 'sharing' | 'denied' | 'unavailable' | 'unsupported' | 'ended' | 'error';

export interface SharingState {
  status: SharingStatus;
  sessionId: string | null;
  /** recordedAt of the last position the server accepted. */
  lastSentAt: string | null;
  accuracyM: number | null;
  sentCount: number;
  message: string | null;
}

const INITIAL: SharingState = { status: 'idle', sessionId: null, lastSentAt: null, accuracyM: null, sentCount: 0, message: null };
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

function optionalNumber(value: number | null | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return undefined;
  return Math.min(value, max);
}

/**
 * Foreground LiveTrack sharing for the assigned representative:
 * POST /tracking/start (after consent) → `watchPosition` (high accuracy) →
 * throttled POST /tracking/location. Permission or position problems are
 * reported with POST /tracking/events. Watching stops on unmount, on Stop,
 * and when the session ends (`tracking:ended` or 409 TRACKING_ENDED).
 */
export function useLocationSharing(pickupId: string, stage: TrackingStage) {
  const qc = useQueryClient();
  const [state, setState] = useState<SharingState>(INITIAL);
  const watchId = useRef<number | null>(null);
  const sessionRef = useRef<string | null>(null);
  const lastAttempt = useRef<PositionSample | null>(null);
  const inFlight = useRef(false);
  const unavailableReported = useRef(false);

  const refreshPickup = useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.pickups.detail(pickupId) });
  }, [qc, pickupId]);

  const clearWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  // Never keep watching after the page is left.
  useEffect(() => () => clearWatch(), [clearWatch]);

  const markEnded = useCallback(
    (message: string | null) => {
      clearWatch();
      sessionRef.current = null;
      setState((s) => ({ ...s, status: 'ended', message }));
      refreshPickup();
    },
    [clearWatch, refreshPickup],
  );

  useSocketEvent<TrackingSessionView>('tracking:ended', (view) => {
    if (view?.id && view.id === sessionRef.current) markEnded(view.endReason ? `Sharing ended: ${view.endReason}.` : 'Sharing ended.');
  });

  const onPosition = useCallback(
    (pos: GeolocationPosition) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      unavailableReported.current = false;
      const accuracy = pos.coords.accuracy;
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
        setState((s) => ({ ...s, message: `GPS accuracy is too low (±${Math.round(accuracy / 1000)} km); waiting for a better position.` }));
        return;
      }
      const sample: PositionSample = { lat: pos.coords.latitude, lng: pos.coords.longitude, time: pos.timestamp || Date.now() };
      if (inFlight.current || !shouldSend(lastAttempt.current, sample)) return;
      inFlight.current = true;
      lastAttempt.current = sample;
      const input: LocationInput = {
        sessionId,
        lat: sample.lat,
        lng: sample.lng,
        recordedAt: new Date(sample.time).toISOString(),
        ...(optionalNumber(accuracy, 0, 100_000) !== undefined ? { accuracyM: optionalNumber(accuracy, 0, 100_000) } : {}),
        ...(optionalNumber(pos.coords.heading, 0, 359.99) !== undefined ? { heading: optionalNumber(pos.coords.heading, 0, 359.99) } : {}),
        ...(optionalNumber(pos.coords.speed, 0, 200) !== undefined ? { speedMps: optionalNumber(pos.coords.speed, 0, 200) } : {}),
      };
      trackingApi
        .location(input)
        .then((res) => {
          if (res.accepted) {
            setState((s) => ({ ...s, status: 'sharing', lastSentAt: input.recordedAt, accuracyM: input.accuracyM ?? null, sentCount: s.sentCount + 1, message: null }));
          } else {
            setState((s) => ({ ...s, message: `A position was not used (${res.reason}).` }));
          }
        })
        .catch((err: unknown) => {
          const e = ApiError.from(err);
          if (e.code === 'TRACKING_ENDED' || e.status === 404) markEnded('This sharing session has ended.');
          else setState((s) => ({ ...s, message: e.message }));
        })
        .finally(() => {
          inFlight.current = false;
        });
    },
    [markEnded],
  );

  const onError = useCallback(
    (err: GeolocationPositionError) => {
      const sessionId = sessionRef.current;
      if (err.code === PERMISSION_DENIED) {
        clearWatch();
        sessionRef.current = null;
        setState((s) => ({ ...s, status: 'denied', message: null }));
        if (sessionId) {
          // Record why no positions arrive, then end the empty session so viewers are not left waiting.
          void trackingApi
            .event({ sessionId }, 'PERMISSION_DENIED', err.message)
            .catch(() => undefined)
            .then(() => trackingApi.stop(sessionId, 'location permission denied'))
            .catch(() => undefined)
            .finally(refreshPickup);
        }
        return;
      }
      if (err.code === POSITION_UNAVAILABLE) {
        setState((s) => ({ ...s, status: s.status === 'sharing' ? 'sharing' : 'unavailable', message: 'Your device cannot determine its position right now (no GPS signal or location services are off).' }));
        if (sessionId && !unavailableReported.current) {
          unavailableReported.current = true;
          void trackingApi.event({ sessionId }, 'POSITION_UNAVAILABLE', err.message).catch(() => undefined);
        }
        return;
      }
      setState((s) => ({ ...s, message: 'Still waiting for a GPS position…' }));
    },
    [clearWatch, refreshPickup],
  );

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ ...INITIAL, status: 'unsupported' });
      void trackingApi.event({ pickupId }, 'POSITION_UNAVAILABLE', 'This browser has no geolocation support').catch(() => undefined);
      return;
    }
    clearWatch();
    setState({ ...INITIAL, status: 'starting' });
    try {
      const session = await trackingApi.start(pickupId, stage);
      sessionRef.current = session.id;
      lastAttempt.current = null;
      unavailableReported.current = false;
      setState({ ...INITIAL, status: 'waiting', sessionId: session.id });
      refreshPickup();
      watchId.current = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
    } catch (err) {
      setState({ ...INITIAL, status: 'error', message: ApiError.from(err).message });
    }
  }, [pickupId, stage, clearWatch, onPosition, onError, refreshPickup]);

  /** Stops watching and ends the session (this tab's, or `sessionId` started elsewhere). */
  const stop = useCallback(
    async (sessionId?: string) => {
      clearWatch();
      const id = sessionId ?? sessionRef.current;
      sessionRef.current = null;
      if (id) {
        try {
          await trackingApi.stop(id, 'stopped by the representative');
        } catch (err) {
          setState((s) => ({ ...s, status: 'error', message: ApiError.from(err).message }));
          return;
        }
      }
      setState((s) => ({ ...s, status: 'ended', message: null }));
      refreshPickup();
    },
    [clearWatch, refreshPickup],
  );

  return { state, start, stop };
}
