export class RoomRegistry {
  constructor(io) {
    this.io = io;
  }

  registerHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('error', (err) => console.error('socket error', err));
    });
  }
}
