import { io, type Socket } from 'socket.io-client';
import { refreshSession } from './apiClient';
import { SOCKET_URL } from './config';

/**
 * Socket.IO connection (one per signed-in tab). The handshake carries the
 * in-memory access token; after every token refresh the realtime provider
 * calls `connectSocket(newToken)` so the server re-authenticates the socket.
 */
export type SocketStatus = 'disconnected' | 'connecting' | 'connected';

let socket: Socket | null = null;
let status: SocketStatus = 'disconnected';
const statusListeners = new Set<() => void>();

function setStatus(next: SocketStatus) {
  if (next === status) return;
  status = next;
  for (const l of statusListeners) l();
}

export function getSocket(): Socket | null {
  return socket;
}

export function getSocketStatus(): SocketStatus {
  return status;
}

export function subscribeSocketStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Connects (or re-authenticates) the shared socket with `token`. */
export function connectSocket(token: string): Socket {
  if (!socket) {
    const options = { path: '/socket.io', auth: { token }, autoConnect: false, reconnection: true, reconnectionDelayMax: 10_000 };
    socket = SOCKET_URL ? io(SOCKET_URL, options) : io(options);
    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', (err: Error) => {
      setStatus('disconnected');
      // The server rejects the handshake with the error code as the message.
      if (err.message === 'TOKEN_EXPIRED' || err.message === 'INVALID_TOKEN') {
        // A successful refresh updates the token store; the provider then reconnects.
        void refreshSession().catch(() => undefined);
      }
    });
  } else {
    socket.auth = { token };
  }
  setStatus('connecting');
  if (socket.connected) socket.disconnect();
  socket.connect();
  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  setStatus('disconnected');
}
