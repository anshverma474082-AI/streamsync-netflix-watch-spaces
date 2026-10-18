import { Router } from 'express';
import { body, validationResult, query, param } from 'express-validator';
import Title from '../models/Title.js';
import { HttpError, requireRole } from '../middleware/auth.js';
import { sanitizeText } from '../utils/text.js';
import { validateTimeline } from '../utils/timelineSchema.js';

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

router.get('/:titleId/timeline/schema', (req, res) => {
  res.json(TIMELINE_SCHEMA_DOC);
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

// Admin timeline ingest. The body is validated against the documented schema
// before anything is written; a non-admin caller never gets past the RBAC
// middleware, so the schema itself is never even parsed.
router.post('/:titleId/timeline', requireRole('admin'), async (req, res, next) => {
  const title = await Title.findById(req.params.titleId);
  if (!title) return next(new HttpError(404, 'Title not found'));
  const { ok, errors, normalized } = validateTimeline(req.body, title.durationSeconds);
  if (!ok) return next(new HttpError(422, 'Timeline failed schema validation', errors));
  const replace = String(req.query.mode ?? 'replace') === 'replace';
  const events = sanitizeTimeline(replace ? normalized : [...title.timeline.toObject(), ...normalized]);
  title.timeline = events;
  await title.save();
  res.json({
    titleId: title._id,
    ingested: normalized.length,
    totalEvents: title.timeline.length,
    mode: replace ? 'replace' : 'merge',
  });
});

function sanitizeTimeline(events) {
  return events.map((e) => ({
    ...e,
    text: e.text !== undefined ? sanitizeText(e.text) : undefined,
    term: e.term !== undefined ? sanitizeText(e.term) : undefined,
    definition: e.definition !== undefined ? sanitizeText(e.definition) : undefined,
    characterName: e.characterName !== undefined ? sanitizeText(e.characterName) : undefined,
    options: e.options?.map((o) => ({ ...o, label: sanitizeText(o.label), text: o.text ? sanitizeText(o.text) : o.text })),
  }));
}

const TIMELINE_SCHEMA_DOC = {
  name: 'streamsync-timeline/v1',
  root: { timeline: 'array of events, required' },
  event: {
    ts: 'number 0..durationSeconds, required',
    type: "one of 'scene' | 'character' | 'trivia' | 'glossary' | 'variationPoint', required",
    text: 'string <=2000 chars; required unless type=glossary',
    characterId: 'string, optional',
    characterName: 'string, required when type=character',
    term: "string, required when type=glossary (paired with definition)",
    definition: 'string, required when type=glossary',
    fromTs: 'number, optional — pins the entry to an explicit span',
    toTs: 'number >= fromTs, optional',
    weight: 'number 0..5, optional (default 1) — authored salience',
    subtitleLocale: "ISO-639 tag, optional — 'hi' packs auto-apply to matching viewer preference",
    variationId: 'string, unique across the timeline, required when type=variationPoint',
    options: 'array of 1-6 pre-authored options, required when type=variationPoint',
  },
  option: { id: 'string unique within the variation point', label: 'string', text: 'string, optional' },
  rules: [
    'All content must be pre-authored and pre-approved; nothing is generated at request time.',
    'variationId values must be unique across a title timeline.',
    'Ingest rejects the whole payload on any schema error and lists every failing path.',
  ],
};

export default router;
