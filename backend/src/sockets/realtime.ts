/**
 * Real-time event emitter. The Socket.IO gateway implements it in the running
 * server; tests use a recording implementation. Emission is best-effort:
 * anything important is persisted first (e.g. notifications), so clients that
 * miss an event can refetch.
 */
export interface Realtime {
  toUser(userId: string, event: string, payload: unknown): void;
  toRoom(room: string, event: string, payload: unknown): void;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const trackingRoom = (sessionId: string) => `tracking:${sessionId}`;

/** Collects events in memory (used by tests and before the gateway attaches). */
export class RecordingRealtime implements Realtime {
  readonly events: { target: string; event: string; payload: unknown }[] = [];
  toUser(userId: string, event: string, payload: unknown): void {
    this.events.push({ target: userRoom(userId), event, payload });
  }
  toRoom(room: string, event: string, payload: unknown): void {
    this.events.push({ target: room, event, payload });
  }
}

/** Forwards to whichever implementation is attached (lets services be built before the HTTP server). */
export class RealtimeHub implements Realtime {
  private target: Realtime = new RecordingRealtime();
  attach(target: Realtime): void {
    this.target = target;
  }
  toUser(userId: string, event: string, payload: unknown): void {
    this.target.toUser(userId, event, payload);
  }
  toRoom(room: string, event: string, payload: unknown): void {
    this.target.toRoom(room, event, payload);
  }
}
