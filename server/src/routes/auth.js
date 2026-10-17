import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { HttpError, authenticate } from '../middleware/auth.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/tokens.js';

const router = Router();

const publicRoutes = process.env.NODE_ENV !== 'production';

router.post(
  '/register',
  body('email').isEmail().normalizeEmail(),
  body('displayName').trim().isLength({ min: 1, max: 60 }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').optional().custom((r) => ['viewer', 'host'].includes(r)),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new HttpError(422, 'Validation failed', errors.array()));
    const { email, displayName, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return next(new HttpError(409, 'An account with this email already exists'));
    if (role === 'admin') return next(new HttpError(403, 'Admin accounts are provisioned by seed only'));
    const user = await User.create({ email, displayName, passwordHash: await bcrypt.hash(password, 12), role });
    res.status(201).json({ user: user.toPublicJSON(), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
  }
);

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new HttpError(422, 'Validation failed', errors.array()));
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return next(new HttpError(401, 'Invalid email or password'));
    }
    res.json({ user: user.toPublicJSON(), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
  }
);

router.post('/refresh', async (req, res, next) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) return next(new HttpError(401, 'Refresh token required'));
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = await User.findById(payload.sub);
    if (!user) return next(new HttpError(401, 'Account no longer exists'));
    res.json({ accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
  } catch {
    next(new HttpError(401, 'Invalid or expired refresh token'));
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

router.patch(
  '/me/preferences',
  authenticate,
  body('subtitleLocale').optional().isString().isLength({ max: 10 }),
  body('genreAffinity').optional().isArray({ max: 20 }),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new HttpError(422, 'Validation failed', errors.array()));
    const { subtitleLocale, genreAffinity } = req.body;
    if (subtitleLocale) req.user.preferences.subtitleLocale = subtitleLocale;
    if (genreAffinity) req.user.preferences.genreAffinity = genreAffinity;
    await req.user.save();
    res.json({ user: req.user.toPublicJSON() });
  }
);

export default router;
