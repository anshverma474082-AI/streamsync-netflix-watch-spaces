const PING_INTERVAL_MS = 5000;
const HARD_SEEK_THRESHOLD = 0.4;
const SOFT_CORR_THRESHOLD = 0.15;

export class SyncController {
  constructor({ video, socket, watchSpaceId }) {
    this.video = video;
    this.socket = socket;
    this.watchSpaceId = watchSpaceId;
    this.isHost = false;
    this.offsetMs = 0;
    this.samples = [];
    this.snapshot = { state: 'paused', positionSeconds: 0, serverTs: Date.now(), rate: 1 };
    this.lastDrift = 0;
    this.onDrift = null;
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    this.tickTimer = setInterval(() => this.correct(), 250);
    this.video.addEventListener('waiting', () => this.isHost && this.socket.emit('room.playback.update', { state: 'buffering', positionSeconds: this.video.currentTime }));
    this.video.addEventListener('loadedmetadata', () => this.correct(true));
  }

  ping() {
    if (!this.socket.connected) return;
    this.pendingSince = Date.now();
    this.socket.emit('room.sync.ping', { clientSentAt: this.pendingSince });
  }

  onPong(payload) {
    if (!payload?.clientSentAt || this.pendingSince !== payload.clientSentAt) return;
    const now = Date.now();
    const rtt = now - payload.clientSentAt;
    const est = payload.serverSentAt + rtt / 2 - now;
    this.samples.push(est);
    if (this.samples.length > 8) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.offsetMs = sorted[Math.floor(sorted.length / 2)];
    this.lastRtt = rtt;
  }

  setSnapshot(snapshot) {
    this.snapshot = snapshot;
    this.snapshotAppliedAt = Date.now();
    this.correct(true);
  }

  serverNow() {
    return Date.now() + this.offsetMs;
  }

  expectedPosition() {
    const s = this.snapshot;
    if (s.state === 'playing') {
      return s.positionSeconds + (this.serverNow() - s.serverTs) / 1000;
    }
    return s.positionSeconds;
  }

  correct(force = false) {
    if (this.isHost) {
      this.video.playbackRate = 1;
      return;
    }
    if (this.video.readyState < 1) return;
    const expected = this.expectedPosition();
    const actual = this.video.currentTime;
    const drift = actual - expected;
    this.lastDrift = drift;
    this.onDrift?.(drift, this.lastRtt);

    if (Math.abs(drift) > HARD_SEEK_THRESHOLD || force) {
      if (Math.abs(actual - expected) > 0.05) this.video.currentTime = expected;
      this.video.playbackRate = 1;
    } else if (Math.abs(drift) > SOFT_CORR_THRESHOLD) {
      this.video.playbackRate = drift > 0 ? 0.95 : 1.05;
    } else {
      this.video.playbackRate = 1;
    }

    if (this.snapshot.state === 'playing' && this.video.paused) this.video.play().catch(() => {});
    if (this.snapshot.state !== 'playing' && !this.video.paused) this.video.pause();
  }

  // Single source of truth for the UI playhead: the host trusts the local
  // element, everyone else derives from the authoritative room clock so the
  // position stays correct even while paused, buffering, or being held by sync.
  currentPosition() {
    return this.isHost ? this.video.currentTime : this.expectedPosition();
  }

  hostAction(state, positionSeconds) {
    this.snapshot = { state, positionSeconds, serverTs: Date.now(), rate: 1 };
    this.socket.emit('room.playback.update', { state, positionSeconds });
  }

  destroy() {
    clearInterval(this.pingTimer);
    clearInterval(this.tickTimer);
  }
}
