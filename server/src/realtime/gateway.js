import { Server } from 'socket.io';
import { verifyAccessToken } from '../utils/tokens.js';
import User from '../models/User.js';
import { RoomRegistry } from './rooms.js';

export function initRealtime(httpServer, env) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  const registry = new RoomRegistry(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error('Account no longer exists'));
      socket.data.user = { id: user._id.toString(), displayName: user.displayName, role: user.role };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  registry.registerHandlers();

  io.of('/health').on('connection', (s) => s.emit('health', { ok: true }));

  return { io, registry };
}
