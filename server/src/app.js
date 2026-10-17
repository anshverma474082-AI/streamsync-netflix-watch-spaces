import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { loadEnv } from './config/env.js';
import { errorHandler } from './middleware/auth.js';
import authRoutes from './routes/auth.js';

export function createApp() {
  const env = loadEnv();
  const app = express();

  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/v1/health', (req, res) => res.json({ ok: true, service: 'streamsync-api', uptime: process.uptime() }));

  app.use('/api/v1/auth', authRoutes);

  app.use((req, res) => res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` }));
  app.use(errorHandler);

  return app;
}
