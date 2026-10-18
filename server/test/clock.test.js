import { RoomClock } from '../src/realtime/clock.js';

describe('RoomClock — authoritative playback state machine', () => {
  test('starts idle at position 0', () => {
    const clock = new RoomClock();
    expect(clock.state).toBe('idle');
    expect(clock.positionAt()).toBe(0);
  });

  test('playing extrapolates position from server time', () => {
    const clock = new RoomClock();
    clock.set({ state: 'playing', positionSeconds: 100 });
    const later = clock.positionAt(Date.now() + 5_000);
    expect(later).toBeGreaterThanOrEqual(105);
    expect(later).toBeLessThan(105.5);
  });

  test('paused freezes position', () => {
    const clock = new RoomClock();
    clock.set({ state: 'playing', positionSeconds: 50 });
    clock.set({ state: 'paused' });
    const frozen = clock.positionSeconds;
    expect(clock.positionAt(Date.now() + 60_000)).toBe(frozen);
  });

  test('set without position keeps the live extrapolated value', () => {
    const clock = new RoomClock();
    clock.set({ state: 'playing', positionSeconds: 200 });
    const snap = clock.set({ state: 'paused' });
    expect(snap.positionSeconds).toBeGreaterThanOrEqual(200);
  });

  test('negative or non-finite positions are rejected', () => {
    const clock = new RoomClock();
    clock.set({ state: 'playing', positionSeconds: 42 });
    const snap = clock.set({ state: 'paused', positionSeconds: -5 });
    expect(snap.positionSeconds).toBeGreaterThanOrEqual(42);
    const bad = clock.set({ state: 'paused', positionSeconds: Number.NaN });
    expect(Number.isFinite(bad.positionSeconds)).toBe(true);
  });

  test('buffering freezes position like paused', () => {
    const clock = new RoomClock();
    clock.set({ state: 'playing', positionSeconds: 80 });
    const snap = clock.set({ state: 'buffering' });
    expect(snap.state).toBe('buffering');
    expect(clock.positionAt(Date.now() + 30_000)).toBe(snap.positionSeconds);
  });

  test('seek while paused jumps to the requested position', () => {
    const clock = new RoomClock();
    clock.set({ state: 'paused', positionSeconds: 10 });
    const snap = clock.set({ state: 'seeking', positionSeconds: 300 });
    expect(snap.positionSeconds).toBe(300);
    expect(snap.state).toBe('seeking');
  });
});
