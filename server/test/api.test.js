// Integration tests run against a dedicated streamsync_test database — the dev
// DB is never touched. NODE_ENV + MONGO_URI must be set before app imports.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/streamsync_test';
process.env.JWT_ACCESS_SECRET = 'test-access';
process.env.JWT_REFRESH_SECRET = 'test-refresh';

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Title } = await import('../src/models/Title.js');
const { default: Interaction } = await import('../src/models/Interaction.js');

let app;
let adminToken;
let viewerToken;
let titleId;

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI);
  await Promise.all([User.deleteMany({}), Title.deleteMany({}), Interaction.deleteMany({})]);
  await User.create({
    email: 'admin@test.dev',
    displayName: 'Adm',
    passwordHash: await bcrypt.hash('admin-pass-1', 10),
    role: 'admin',
  });
  await User.create({
    email: 'view@test.dev',
    displayName: 'Vic',
    passwordHash: await bcrypt.hash('view-pass-1', 10),
    role: 'viewer',
    preferences: { genreAffinity: ['sci-fi'] },
  });
  const title = await Title.create({
    name: 'Test Toon',
    description: 'fixture',
    durationSeconds: 300,
    genres: ['sci-fi'],
    videoAssetUrl: '/media/x.mp4',
    timeline: [{ ts: 10, type: 'scene', text: 'A test scene.' }],
  });
  titleId = String(title._id);
  app = createApp();
  const login = async (email) =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: email.startsWith('admin') ? 'admin-pass-1' : 'view-pass-1' })).body.accessToken;
  adminToken = await login('admin@test.dev');
  viewerToken = await login('view@test.dev');
});

afterAll(async () => {
  await disconnectDB();
});

const auth = (t) => ({ authorization: `Bearer ${t}` });

describe('auth + RBAC', () => {
  test('protected routes reject anonymous callers', async () => {
    expect((await request(app).get('/api/v1/titles')).status).toBe(401);
    expect((await request(app).get('/api/v1/recommendations/me')).status).toBe(401);
  });

  test('register creates a viewer and refuses self-promotion to admin', async () => {
    const ok = await request(app).post('/api/v1/auth/register').send({
      email: `new${Date.now()}@test.dev`,
      displayName: 'Newbie',
      password: 'longenough1',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe('viewer');
    const sneaky = await request(app).post('/api/v1/auth/register').send({
      email: `sneak${Date.now()}@test.dev`,
      displayName: 'Sneak',
      password: 'longenough1',
      role: 'admin',
    });
    // Rejected either by the role validator (422) or the explicit admin guard (403).
    expect([403, 422]).toContain(sneaky.status);
  });

  test('bad credentials never mint tokens', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'view@test.dev', password: 'wrong' });
    expect(r.status).toBe(401);
  });
});

describe('timeline ingest endpoint', () => {
  test('viewer cannot upload (403) — admin can', async () => {
    const body = { timeline: [{ ts: 20, type: 'trivia', text: 'Admin authored fact.' }] };
    expect((await request(app).post(`/api/v1/titles/${titleId}/timeline`).set(auth(viewerToken)).send(body)).status).toBe(403);
    const ok = await request(app).post(`/api/v1/titles/${titleId}/timeline`).set(auth(adminToken)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.ingested).toBe(1);
  });

  test('invalid events return 422 with per-path errors and change nothing', async () => {
    const before = await Title.findById(titleId);
    const r = await request(app)
      .post(`/api/v1/titles/${titleId}/timeline`)
      .set(auth(adminToken))
      .send({ timeline: [{ ts: -1, type: 'nope' }] });
    expect(r.status).toBe(422);
    expect(r.body.details.every((d) => d.path && d.message)).toBe(true);
    const after = await Title.findById(titleId);
    expect(after.timeline.length).toBe(before.timeline.length);
  });

  test('schema is documented for integrators', async () => {
    const r = await request(app).get(`/api/v1/titles/${titleId}/timeline/schema`).set(auth(viewerToken));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('streamsync-timeline/v1');
  });
});

describe('recommendations API', () => {
  test('rating a title upserts an interaction and retrains the rail', async () => {
    const r = await request(app)
      .post('/api/v1/recommendations/me/ratings')
      .set(auth(viewerToken))
      .send({ titleId, rating: 4.5 });
    expect(r.status).toBe(200);
    expect(r.body.interaction.rating).toBe(4.5);
    const again = await request(app)
      .post('/api/v1/recommendations/me/ratings')
      .set(auth(viewerToken))
      .send({ titleId, rating: 3 });
    expect(again.body.interaction.rating).toBe(3);
    const rows = await Interaction.find({ userId: (await User.findOne({ email: 'view@test.dev' }))._id, titleId });
    expect(rows.length).toBe(1);
  });

  test('rating validation rejects junk', async () => {
    const r = await request(app).post('/api/v1/recommendations/me/ratings').set(auth(viewerToken)).send({ titleId: 'not-an-id', rating: 9 });
    expect(r.status).toBe(422);
  });

  test('retrain is admin-only and reports precision@K', async () => {
    expect((await request(app).post('/api/v1/recommendations/retrain').set(auth(viewerToken))).status).toBe(403);
    const r = await request(app).post('/api/v1/recommendations/retrain').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('evaluation.precision');
  });

  test('session analytics are admin-only', async () => {
    expect((await request(app).get('/api/v1/recommendations/analytics/sessions').set(auth(viewerToken))).status).toBe(403);
    const r = await request(app).get('/api/v1/recommendations/analytics/sessions').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.sessions)).toBe(true);
  });
});
