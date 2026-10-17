import http from 'http';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();

async function main() {
  await connectDB(env.mongoUri);
  const app = createApp();
  const server = http.createServer(app);

  const { initRealtime } = await import('./realtime/gateway.js');
  initRealtime(server, env);

  server.listen(env.port, () => {
    console.log(`StreamSync API + realtime gateway listening on :${env.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
