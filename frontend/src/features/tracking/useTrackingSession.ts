import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSocketEvent, useSocketStatus } from '@/hooks/useSocket';
import { qk } from '@/services/queryKeys';
import { getSocket } from '@/services/socket';
import type { TrackingPoint, TrackingSessionView } from '@/types';
import { useTrackingPathQuery, useTrackingSessionQuery } from './api';

const POLL_WITH_SOCKET_MS = 30_000;
const POLL_WITHOUT_SOCKET_MS = 10_000;

/**
 * LiveTrack data for one session: REST snapshot + path, live updates through
 * the Socket.IO room (`tracking:join`), and a polling fallback that speeds up
 * whenever the socket is not joined.
 */
export function useTrackingSession(sessionId: string) {
  const qc = useQueryClient();
  const status = useSocketStatus();
  const [joinedSession, setJoinedSession] = useState<string | null>(null);
  const joined = status === 'connected' && joinedSession === sessionId;
  const active = (qc.getQueryData<TrackingSessionView>(qk.tracking.session(sessionId))?.status ?? 'ACTIVE') === 'ACTIVE';
  const interval = active ? (joined ? POLL_WITH_SOCKET_MS : POLL_WITHOUT_SOCKET_MS) : false;
  const session = useTrackingSessionQuery(sessionId, interval);
  const path = useTrackingPathQuery(sessionId, interval);

  useEffect(() => {
    const socket = getSocket();
    if (status !== 'connected' || !socket) return;
    let cancelled = false;
    socket.emit('tracking:join', { sessionId }, (ack: { ok: boolean; session?: TrackingSessionView }) => {
      if (cancelled) return;
      setJoinedSession(ack?.ok ? sessionId : null);
      if (ack?.ok && ack.session) qc.setQueryData(qk.tracking.session(sessionId), ack.session);
    });
    return () => {
      cancelled = true;
      socket.emit('tracking:leave', { sessionId });
    };
  }, [status, sessionId, qc]);

  useSocketEvent<TrackingSessionView>('tracking:location', (view) => {
    if (view?.id !== sessionId) return;
    qc.setQueryData(qk.tracking.session(sessionId), view);
    if (view.lastPosition) {
      const point: TrackingPoint = { lat: view.lastPosition.lat, lng: view.lastPosition.lng, accuracyM: view.lastPosition.accuracyM, recordedAt: view.lastPosition.recordedAt };
      qc.setQueryData<TrackingPoint[]>(qk.tracking.path(sessionId), (old) => (old ? [point, ...old.filter((p) => p.recordedAt !== point.recordedAt)] : [point]));
    }
  });
  useSocketEvent<TrackingSessionView>('tracking:ended', (view) => {
    if (view?.id === sessionId) qc.setQueryData(qk.tracking.session(sessionId), view);
  });
  // Events (permission denied, reconnected…) carry no session view: refetch.
  useSocketEvent('tracking:event', () => {
    void qc.invalidateQueries({ queryKey: qk.tracking.session(sessionId) });
  });

  return { session, path, joined };
}
