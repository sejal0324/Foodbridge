import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { AppContext, Services } from '../container.js';
import type { AuthContext } from '../types/auth.js';
import { AppError } from '../utils/errors.js';
import { trackingRoom, userRoom, type Realtime } from './realtime.js';

interface SocketData {
  auth: AuthContext;
}

/**
 * Socket.IO gateway. The handshake must carry a valid access token
 * (`auth: { token }`); each socket joins only its own user room. Joining a
 * tracking room requires the same authorisation check as the REST endpoint.
 */
export function attachSocketGateway(httpServer: HttpServer, ctx: AppContext, services: Services): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: ctx.config.corsOrigins, credentials: true },
    maxHttpBufferSize: 64 * 1024,
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown }).token;
      if (typeof token !== 'string') throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
      (socket.data as SocketData).auth = await services.auth.authenticate(token);
      next();
    } catch (err) {
      next(new Error(err instanceof AppError ? err.code : 'UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { auth } = socket.data as SocketData;
    void socket.join(userRoom(auth.userId));

    socket.on('tracking:join', async (payload: unknown, ack?: (r: unknown) => void) => {
      const sessionId = typeof payload === 'object' && payload !== null ? (payload as { sessionId?: unknown }).sessionId : undefined;
      try {
        if (typeof sessionId !== 'string') throw new AppError(400, 'BAD_REQUEST', 'sessionId required');
        const view = await services.tracking.getSession(auth, sessionId, { userId: auth.userId, role: auth.role, type: 'USER' });
        await socket.join(trackingRoom(sessionId));
        ack?.({ ok: true, session: view });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof AppError ? err.code : 'ERROR' });
      }
    });

    socket.on('tracking:leave', (payload: unknown) => {
      const sessionId = typeof payload === 'object' && payload !== null ? (payload as { sessionId?: unknown }).sessionId : undefined;
      if (typeof sessionId === 'string') void socket.leave(trackingRoom(sessionId));
    });
  });

  const target: Realtime = {
    toUser: (userId, event, payload) => io.to(userRoom(userId)).emit(event, payload),
    toRoom: (room, event, payload) => io.to(room).emit(event, payload),
  };
  ctx.realtime.attach(target);
  return io;
}
