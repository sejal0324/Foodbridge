import type { Liveness, TrackingSessionView } from '@/types';

export interface EffectiveLiveness {
  liveness: Liveness;
  /** Seconds since the last recorded position (null when there is none). */
  ageSeconds: number | null;
}

/**
 * Liveness as of `nowMs`. The server's label is computed when the response is
 * produced; this re-evaluates it on the client clock so a position that has
 * aged past `staleAfterSeconds` is shown as STALE, never as LIVE. A server
 * STALE/ENDED is never upgraded.
 */
export function effectiveLiveness(session: Pick<TrackingSessionView, 'status' | 'liveness' | 'lastPosition' | 'staleAfterSeconds'>, nowMs: number): EffectiveLiveness {
  const recordedAt = session.lastPosition?.recordedAt ? Date.parse(session.lastPosition.recordedAt) : Number.NaN;
  const ageSeconds = Number.isNaN(recordedAt) ? null : Math.max(0, Math.round((nowMs - recordedAt) / 1000));
  if (session.status !== 'ACTIVE' || session.liveness === 'ENDED') return { liveness: 'ENDED', ageSeconds };
  if (ageSeconds === null) return { liveness: 'WAITING_FOR_FIRST_POSITION', ageSeconds };
  if (session.liveness === 'STALE' || ageSeconds > session.staleAfterSeconds) return { liveness: 'STALE', ageSeconds };
  return { liveness: 'LIVE', ageSeconds };
}

/** "45 s", "3 min", "2 h". */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
