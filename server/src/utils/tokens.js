import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env.js';

export function signAccessToken(user) {
  const env = loadEnv();
  return jwt.sign({ sub: user._id.toString(), role: user.role, type: 'access' }, env.accessSecret, {
    expiresIn: env.accessTtl,
  });
}

export function signRefreshToken(user) {
  const env = loadEnv();
  return jwt.sign({ sub: user._id.toString(), type: 'refresh' }, env.refreshSecret, {
    expiresIn: env.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  const env = loadEnv();
  const payload = jwt.verify(token, env.accessSecret);
  if (payload.type !== 'access') throw new Error('Not an access token');
  return payload;
}

export function verifyRefreshToken(token) {
  const env = loadEnv();
  const payload = jwt.verify(token, env.refreshSecret);
  if (payload.type !== 'refresh') throw new Error('Not a refresh token');
  return payload;
}
