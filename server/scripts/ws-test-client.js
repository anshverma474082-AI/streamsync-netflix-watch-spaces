// Multi-client end-to-end harness: drives a full watch-space lifecycle over REST +
// Socket.io with two real sockets, then asserts the persisted side effects.
// Usage: node scripts/ws-test-client.js [baseUrl]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const API = `${BASE}/api/v1`;
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function login(email, password) {
  return api('/auth/login', { method: 'POST', body: { email, password } }).then((r) => {
    if (!r.json?.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
    return r.json.accessToken;
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    socket.timeout(2500).on('connect', () => {});
  });
}

// Collects the latest payload per event name from the room.event envelope.
function attachRecorder(socket) {
  const seen = [];
  const waiters = [];
  socket.on('room.event', (env) => {
    seen.push(env);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const w = waiters[i];
      if (w.event === env.event && (!w.match || w.match(env.payload))) {
        waiters.splice(i, 1);
        w.resolve(env.payload);
      }
    }
  });
  return {
    seen,
    waitFor(event, ms = 4000, match = null) {
      const existing = seen.find((e) => e.event === event && (!match || match(e.payload)));
      if (existing) return Promise.resolve(existing.payload);
      return new Promise((resolve, reject) => {
        const w = { event, resolve, match };
        waiters.push(w);
        setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log(`StreamSync end-to-end harness → ${BASE}`);
  const health = await api('/health');
  check('health endpoint', health.status === 200 && health.json?.ok === true);

  const hostToken = await login('host@streamsync.dev', 'streamsync-host-1');
  const anaToken = await login('ana@streamsync.dev', 'streamsync-fan-1');
  const adminToken = await login('admin@streamsync.dev', 'streamsync-admin-1');

  const titles = await api('/titles', { token: hostToken });
  const bbb = titles.json.titles.find((t) => t.name === 'Big Buck Bunny');
  check('catalog lists Big Buck Bunny', Boolean(bbb), bbb?._id);

  const created = await api('/watch-spaces', {
    method: 'POST',
    token: hostToken,
    body: { titleId: bbb._id, roomName: 'Harness Room', maxParticipants: 6 },
  });
  const spaceId = created.json?.watchSpaceId ?? created.json?._id ?? created.json?.id ?? created.json?.space?._id;
  check('watch space created', created.status === 201 && Boolean(spaceId), JSON.stringify(created.json).slice(0, 120));

  const host = await connect(hostToken);
  const ana = await connect(anaToken);
  const hRec = attachRecorder(host);
  const aRec = attachRecorder(ana);

  host.emit('room.join', { watchSpaceId: spaceId });
  await hRec.waitFor('room.snapshot', 3000).catch(() => hRec.seen.at(-1));
  ana.emit('room.join', { watchSpaceId: spaceId });
  await sleep(400);
  const presence = aRec.seen.filter((e) => e.event === 'room.presence.update');
  check('two participants present', presence.length > 0 && host.connected && ana.connected);

  // Playback: run ~2.5s of "watching", then pause.
  host.emit('room.playback.update', { state: 'playing', positionSeconds: 160 });
  await sleep(2500);
  host.emit('room.playback.update', { state: 'paused', positionSeconds: 162.5 });
  await sleep(300);
  const pb = aRec.seen.filter((e) => e.event === 'room.playback.update');
  check('mirrors receive playback updates', pb.length >= 2, `pos=${pb.at(-1)?.payload?.positionSeconds?.toFixed?.(2)}`);

  // Grounded AI question at 162.5s: Frank appears at ts=162, inside the window.
  ana.emit('room.ai.ask', { question: 'who is Frank?' });
  const answer = await aRec.waitFor('room.ai.answer', 4000).catch((e) => e);
  check(
    'AI answer grounded with citations',
    answer?.grounded === true && (answer?.sourceEvents?.length ?? 0) > 0,
    answer?.sourceEvents?.map((s) => `${s.type}@${s.ts}`).join(',') ?? String(answer?.answer ?? answer)
  );

  // Chat (also feeds summary chatVolume reconciliation).
  ana.emit('room.chat.send', { body: 'harness hello' });
  const chatMsg = await hRec.waitFor('room.chat.message', 3000, (p) => p.body === 'harness hello').catch(() => null);
  check('chat broadcast across clients', chatMsg?.body === 'harness hello');

  // Host ends the room → summary + interaction flush.
  host.emit('room.end', {});
  const ended = await hRec.waitFor('room.ended', 5000).catch(() => null);
  const summary = ended?.summary;
  check('room ended with summary', Boolean(summary), JSON.stringify(summary ?? {}).slice(0, 200));
  check(
    'summary tracks session watch seconds',
    (summary?.watchedSeconds ?? 0) >= 2 && (summary?.participants?.length ?? 0) === 2,
    `watched=${summary?.watchedSeconds} participants=${summary?.participants?.map((p) => p.watchedSeconds)}`
  );

  await sleep(800); // let async DB flushes land

  const anaInteractions = await api('/recommendations/me/interactions', { token: anaToken });
  const anaBbb = anaInteractions.json?.interactions?.find((i) => i.title?.name === 'Big Buck Bunny');
  check(
    'interaction totals accumulate (not clobbered by short session)',
    (anaBbb?.watchedSeconds ?? 0) >= 596,
    `ana BBB lifetime=${anaBbb?.watchedSeconds} (seeded 596 + per-run session seconds)`
  );

  const rail = await api('/recommendations/me', { token: anaToken });
  check(
    'recommender serves Ana a rail excluding watched titles',
    rail.status === 200 && rail.json.recommendations.every((r) => r.name !== 'Big Buck Bunny'),
    rail.json?.recommendations?.map((r) => `${r.name}(${r.score})`).join(', ') ?? String(rail.status)
  );

  const sessions = await api('/recommendations/analytics/sessions', { token: adminToken });
  const sess = (sessions.json?.sessions ?? []).find((s) => String(s.watchSpaceId) === String(spaceId));
  check(
    'analytics reconciles ended session',
    Boolean(sess) && sess.reconciled?.chatVolume === true && sess.reconciled?.participants === true,
    sess ? `chat=${sess.summary?.chatVolume}/${sess.persisted?.chatVolume} participants=${sess.persisted?.participantsRecorded}` : 'session not found'
  );
  const forbidden = await api('/recommendations/analytics/sessions', { token: anaToken });
  check('analytics is admin-only', forbidden.status === 403);

  // Unauthenticated access checks
  const anon = await api('/recommendations/me');
  check('recommendations require auth', anon.status === 401);

  host.close();
  ana.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}

run().catch((err) => {
  console.error('Harness crashed:', err.message);
  process.exit(1);
});
