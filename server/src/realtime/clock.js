export class RoomClock {
  constructor() {
    this.state = 'idle';
    this.positionSeconds = 0;
    this.serverTs = Date.now();
    this.rate = 1;
  }

  snapshot() {
    return {
      state: this.state,
      positionSeconds: this.positionSeconds,
      serverTs: this.serverTs,
      rate: this.rate,
    };
  }

  positionAt(nowMs = Date.now()) {
    if (this.state !== 'playing') return this.positionSeconds;
    return this.positionSeconds + (nowMs - this.serverTs) / 1000 * this.rate;
  }

  set({ state, positionSeconds }) {
    if (positionSeconds != null && Number.isFinite(positionSeconds) && positionSeconds >= 0) {
      this.positionSeconds = positionSeconds;
    } else {
      this.positionSeconds = this.positionAt();
    }
    this.state = state;
    this.serverTs = Date.now();
    return this.snapshot();
  }
}
