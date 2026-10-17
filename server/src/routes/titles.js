import { Router } from 'express';
import { body, validationResult, query, param } from 'express-validator';
import Title from '../models/Title.js';
import { HttpError } from '../middleware/auth.js';
import { sanitizeText } from '../utils/text.js';

const router = Router();

router.get('/', async (req, res, next) => {
  const titles = await Title.find().select('-timeline').lean();
  res.json({ titles });
});

router.get('/:titleId', async (req, res, next) => {
  const title = await Title.findById(req.params.titleId).lean();
  if (!title) return next(new HttpError(404, 'Title not found'));
  res.json({ title });
});

router.get('/:titleId/timeline', query('from').optional().isNumeric(), query('to').optional().isNumeric(), async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(new HttpError(422, 'from and to must be numbers', errors.array()));
  const title = await Title.findById(req.params.titleId).lean();
  if (!title) return next(new HttpError(404, 'Title not found'));
  const from = Number(req.query.from ?? 0);
  const to = Number(req.query.to ?? title.durationSeconds);
  const events = title.timeline
    .filter((e) => e.ts >= from && e.ts <= to)
    .map((e) => {
      const out = { ts: e.ts, type: e.type };
      if (e.text) out.text = e.text;
      if (e.characterName) out.characterName = e.characterName;
      if (e.term) out.term = e.term;
      if (e.definition) out.definition = e.definition;
      if (e.variationId) {
        out.variationId = e.variationId;
        out.options = e.options;
      }
      if (e.subtitleLocale) out.subtitleLocale = e.subtitleLocale;
      return out;
    });
  res.json({ titleId: title._id.toString(), events });
});

export default router;
