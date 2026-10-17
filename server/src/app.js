import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { authenticate, errorHandler } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import titleRoutes from './routes/titles.js';
import watchSpaceRoutes from './routes/watchSpaces.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(here, '..', 'media');

export function createApp() {
  const env = loadEnv();
  const app = express();

  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

  // Range-aware static delivery for the locally stored open-license test clips.
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h', fallthrough: true }));

  app.get('/api/v1/health', (req, res) => res.json({ ok: true, service: 'streamsync-api', uptime: process.uptime() }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/titles', authenticate, titleRoutes);
  app.use('/api/v1/watch-spaces', authenticate, watchSpaceRoutes);

  app.use((req, res) => res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` }));
  app.use(errorHandler);

  return app;
}
