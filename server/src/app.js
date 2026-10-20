import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { authenticate, errorHandler } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import titleRoutes from './routes/titles.js';
import watchSpaceRoutes from './routes/watchSpaces.js';
import recommendationRoutes from './routes/recommendations.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(here, '..', 'media');
const CLIENT_DIST = path.join(here, '..', '..', 'client', 'dist');

// Same URLs scripts/fetch-media.sh downloads locally from. In cloud deploys the
// mp4s are not bundled with the code, so /media/<clip> redirects to the source.
const REMOTE_MEDIA = {
  'big-buck-bunny.mp4': 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
  'elephants-dream.mp4': 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
  'sintel.mp4': 'https://archive.org/download/Sintel/sintel-2048-surround_512kb.mp4',
};

export function createApp() {
  const env = loadEnv();
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

  if (env.mediaMode === 'remote') {
    app.get('/media/:name', (req, res, next) => {
      const url = REMOTE_MEDIA[req.params.name];
      if (url) return res.redirect(302, url);
      next();
    });
  }

  // Range-aware static delivery for the locally stored open-license test clips.
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h', fallthrough: true }));

  app.get('/api/v1/health', (req, res) => res.json({ ok: true, service: 'streamsync-api', uptime: process.uptime() }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/titles', authenticate, titleRoutes);
  app.use('/api/v1/watch-spaces', authenticate, watchSpaceRoutes);
  app.use('/api/v1/recommendations', authenticate, recommendationRoutes);

  // Single-service deploy: serve the built React app from the same origin so
  // the client's relative /api/v1 and socket.io paths work with no proxy.
  const indexHtml = path.join(CLIENT_DIST, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(CLIENT_DIST, { index: false }));
    app.get(/^(?!\/api\/|\/media\/|\/socket\.io).*/, (req, res) => res.sendFile(indexHtml));
  }

  app.use((req, res) => res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` }));
  app.use(errorHandler);

  return app;
}
