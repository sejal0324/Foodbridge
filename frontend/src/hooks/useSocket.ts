import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSocket, getSocketStatus, subscribeSocketStatus, type SocketStatus } from '@/services/socket';

export function useSocketStatus(): SocketStatus {
  return useSyncExternalStore(subscribeSocketStatus, getSocketStatus, () => 'disconnected' as const);
}

/**
 * Subscribes to a Socket.IO event for the lifetime of the component. The
 * latest handler is always used without re-subscribing.
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const status = useSocketStatus();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const listener = (payload: T) => ref.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
    // Re-attach when the socket instance appears (status changes from disconnected).
  }, [event, status]);
}
