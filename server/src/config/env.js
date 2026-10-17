import 'dotenv/config';

const required = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

export function loadEnv() {
  if (process.env.NODE_ENV === 'test') {
    process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/streamsync_test';
    process.env.JWT_ACCESS_SECRET ??= 'test-access';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh';
  }
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}. Copy .env.example to .env and set it.`);
    }
  }
  return {
    port: Number(process.env.PORT ?? 4000),
    mongoUri: process.env.MONGO_URI,
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',
    clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  };
}
