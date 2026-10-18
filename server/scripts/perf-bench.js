// Measured performance numbers for docs/PERFORMANCE.md.
// Drives a real room with N mirror viewers and reports percentiles for:
//   playback fan-out latency, AI answer latency, API response time, sync RTT.
// Usage: node scripts/perf-bench.js [viewers=10]
import { io } from 'socket.io-client';

const BASE = process.argv[2] ? `http://${process.argv[2]}` : 'http://localhost:4000';
const N_VIEWS = Number(process.argv[3] ?? 10);
const API = `${BASE}/api/v1`;

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function api(path, token) {
  const res = await fetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return res.json();
}

async function login(email, password) {
  return (await post('/auth/login', null, { email, password })).accessToken;
}

async function post(path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Benching ${BASE} with ${N_VIEWS} mirror viewers…`);
  const hostToken = await login('host@streamsync.dev', 'streamsync-host-1');
  const viewerToken = await login('ana@streamsync.dev', 'streamsync-fan-1');
  const titles = await api('/titles', hostToken);
  const bbb = titles.titles.find((t) => t.name === 'Big Buck Bunny');
  const space = await post('/watch-spaces', hostToken, { titleId: bbb._id, roomName: 'Perf Bench', maxParticipants: N_VIEWS + 2 });

  const connect = (token) =>
    new Promise((resolve, reject) => {
      const s = io(BASE, { auth: { token }, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  const host = await connect(hostToken);
  const viewers = [];
  for (let i = 0; i < N_VIEWS; i += 1) viewers.push(await connect(viewerToken));

  const fanout = [];
  for (const v of viewers) {
    v.on('room.event', (env) => {
      if (env.event === 'room.playback.update' && env.payload?.issuedBy === space.hostUserId) {
        fanout.push(Date.now() - env.ts);
      }
    });
    v.emit('room.join', { watchSpaceId: space.watchSpaceId });
  }
  host.emit('room.join', { watchSpaceId: space.watchSpaceId });
  await sleep(600);

  // Playback fan-out: 20 updates, collect per-receiver latency.
  for (let i = 0; i < 20; i += 1) {
    host.emit('room.playback.update', { state: 'playing', positionSeconds: 100 + i * 2 });
    await sleep(120);
  }
  host.emit('room.playback.update', { state: 'paused', positionSeconds: 140 });
  await sleep(400);

  // AI answer latency (server-measured inside room.ai.answer).
  const aiLatencies = [];
  const aiProbe = viewers[0];
  aiProbe.on('room.event', (env) => {
    if (env.event === 'room.ai.answer') aiLatencies.push(env.payload.latencyMs);
  });
  const questions = ['who is Frank?', 'what is Blender?', 'who is Gamera?', 'what happens next?', 'who is Bunny?'];
  for (let i = 0; i < 25; i += 1) {
    aiProbe.emit('room.ai.ask', { question: questions[i % questions.length] });
    await sleep(60);
  }
  await sleep(500);

  // Sync RTT via room.sync.ping (client clock estimate).
  const rtts = [];
  await new Promise((resolve) => {
    const v = viewers[1];
    const sent = Date.now();
    v.emit('room.sync.ping', { clientSentAt: sent });
    v.on('room.event', function pong(env) {
      if (env.event === 'room.sync.pong') {
        rtts.push(Date.now() - sent);
        v.off('room.event', pong);
        resolve();
      }
    });
  });
  for (let i = 0; i < 15; i += 1) {
    const v = viewers[1];
    const sent = Date.now();
    await new Promise((resolve) => {
      v.emit('room.sync.ping', { clientSentAt: sent });
      v.on('room.event', function pong(env) {
        if (env.event === 'room.sync.pong') {
          rtts.push(Date.now() - sent);
          v.off('room.event', pong);
          resolve();
        }
      });
    });
  }

  // API latency: 60 sequential calls each.
  async function benchApi(path, token, n = 60) {
    const times = [];
    for (let i = 0; i < n; i += 1) {
      const t0 = performance.now();
      await fetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      times.push(performance.now() - t0);
    }
    return { p50: Number(pct(times, 50).toFixed(1)), p95: Number(pct(times, 95).toFixed(1)), max: Number(Math.max(...times).toFixed(1)) };
  }
  const apiHealth = await benchApi('/health', null);
  const apiTitles = await benchApi('/titles', viewerToken);
  const apiRecs = await benchApi('/recommendations/me', viewerToken);

  host.emit('room.end', {});
  await sleep(500);
  host.close();
  viewers.forEach((v) => v.close());

  const report = {
    viewersEach: N_VIEWS,
    playbackFanoutMs: { samples: fanout.length, p50: pct(fanout, 50), p95: pct(fanout, 95), max: Math.max(...fanout) },
    aiAnswerMs: { samples: aiLatencies.length, p50: pct(aiLatencies, 50), p95: pct(aiLatencies, 95), max: Math.max(...aiLatencies) },
    syncPingRttMs: { samples: rtts.length, p50: pct(rtts, 50), p95: pct(rtts, 95), max: Math.max(...rtts) },
    api: { health: apiHealth, titles: apiTitles, recommendations: apiRecs },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
