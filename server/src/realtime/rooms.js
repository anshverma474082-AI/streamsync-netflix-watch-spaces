import { Room } from './Room.js';
import WatchSpace from '../models/WatchSpace.js';
import Title from '../models/Title.js';

export class RoomRegistry {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  async getOrCreate(watchSpaceId) {
    if (this.rooms.has(watchSpaceId)) return this.rooms.get(watchSpaceId);
    const doc = await WatchSpace.findById(watchSpaceId).lean().then((d) => (d ? WatchSpace.hydrate(d) : null));
    if (!doc || doc.status === 'ended') return null;
    const title = await Title.findById(doc.titleId);
    if (!title) return null;
    if (doc.status !== 'live' && !doc.startedAt) doc.startedAt = new Date();
    const room = new Room({ io: this.io, doc, title, registry: this });
    this.rooms.set(watchSpaceId, room);
    WatchSpace.updateOne({ _id: watchSpaceId }, { status: 'live', startedAt: doc.startedAt }).catch(() => {});
    return room;
  }

  forget(watchSpaceId) {
    const room = this.rooms.get(watchSpaceId);
    if (room) room.close();
    this.rooms.delete(watchSpaceId);
  }

  registerHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('room.join', async ({ watchSpaceId, inviteCode } = {}) => {
        try {
          if (!watchSpaceId) return;
          const room = await this.getOrCreate(watchSpaceId);
          if (!room) return socket.emit('room.event', { event: 'room.error', payload: { code: 'NOT_FOUND', message: 'Watch space not found or ended' } });
          if (room.doc.settings.isLocked && socket.data.user.id !== room.hostUserId && inviteCode !== room.doc.inviteCode) {
            return socket.emit('room.event', { event: 'room.error', payload: { code: 'WRONG_CODE', message: 'Room is locked; a valid invite code is required' } });
          }
          const result = room.join(socket, socket.data.user);
          socket.data.lastWatchSpaceId = watchSpaceId;
          if (result.error) {
            socket.emit('room.event', { event: 'room.error', payload: { code: result.error, message: humanJoinError(result.error) } });
            return;
          }
          if (!result.resumed) {
            WatchSpace.updateOne(
              { _id: watchSpaceId, 'participants.userId': socket.data.user.id },
              { $addToSet: { participants: { userId: socket.data.user.id, joinedAt: new Date() } } }
            ).catch(() => {});
          }
        } catch (err) {
          console.error('room.join failed', err);
        }
      });

      socket.on('disconnect', () => {
        for (const r of this.rooms.values()) {
          if (r.participants.get(socket.data.user.id)?.socket === socket) r.handleDisconnect(socket);
        }
      });
    });
  }

  activeRoomIdsFor(userId) {
    return [...this.rooms.values()].filter((r) => r.participants.has(userId)).map((r) => r.id);
  }
}

function humanJoinError(code) {
  switch (code) {
    case 'ROOM_FULL':
      return 'This room has reached its participant limit';
    case 'ROOM_LOCKED':
      return 'This room is locked by the host';
    case 'ALREADY_IN_ROOM':
      return 'You are already connected from another tab';
    default:
      return 'Could not join room';
  }
}
