// Documented timeline ingest schema (see docs/TIMELINE_SCHEMA.md). Uploads are
// validated here before anything touches the database, and every rejected field
// is reported with its path so an admin can fix the file offline.

const EVENT_TYPES = ['scene', 'character', 'trivia', 'glossary', 'variationPoint'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateEvent(evt, index, durationSeconds, errors) {
  const at = (field) => errors.push({ path: `timeline[${index}].${field}`, message: 'missing or invalid' });
  if (!evt || typeof evt !== 'object') return errors.push({ path: `timeline[${index}]`, message: 'must be an object' });
  if (!isFiniteNumber(evt.ts) || evt.ts < 0 || evt.ts > durationSeconds) at('ts');
  if (!EVENT_TYPES.includes(evt.type)) {
    errors.push({ path: `timeline[${index}].type`, message: `must be one of ${EVENT_TYPES.join(', ')}` });
  }
  const hasText = typeof evt.text === 'string' && evt.text.trim().length > 0 && evt.text.length <= 2000;
  const isGlossary = evt.type === 'glossary';
  if (!hasText && !isGlossary) at('text');
  if (isGlossary && (typeof evt.term !== 'string' || typeof evt.definition !== 'string')) at('term/definition');
  if (evt.type === 'character' && typeof evt.characterName !== 'string') at('characterName');
  for (const span of ['fromTs', 'toTs']) {
    if (evt[span] !== undefined && !isFiniteNumber(evt[span])) at(span);
  }
  if (evt.fromTs !== undefined && evt.toTs !== undefined && evt.fromTs > evt.toTs) {
    errors.push({ path: `timeline[${index}].fromTs`, message: 'fromTs must not exceed toTs' });
  }
  if (evt.weight !== undefined && (!isFiniteNumber(evt.weight) || evt.weight < 0 || evt.weight > 5)) at('weight');
  if (evt.subtitleLocale !== undefined && (typeof evt.subtitleLocale !== 'string' || evt.subtitleLocale.length > 10)) at('subtitleLocale');
  if (evt.type === 'variationPoint') {
    if (typeof evt.variationId !== 'string' || !evt.variationId) at('variationId');
    if (!Array.isArray(evt.options) || evt.options.length < 1 || evt.options.length > 6) {
      errors.push({ path: `timeline[${index}].options`, message: 'must be an array of 1-6 pre-authored options' });
    } else {
      evt.options.forEach((opt, oi) => {
        if (!opt || typeof opt !== 'object') return errors.push({ path: `timeline[${index}].options[${oi}]`, message: 'must be an object' });
        if (typeof opt.id !== 'string' || !opt.id) errors.push({ path: `timeline[${index}].options[${oi}].id`, message: 'required string' });
        if (typeof opt.label !== 'string' || !opt.label) errors.push({ path: `timeline[${index}].options[${oi}].label`, message: 'required string' });
        if (opt.text !== undefined && typeof opt.text !== 'string') {
          errors.push({ path: `timeline[${index}].options[${oi}].text`, message: 'must be a string' });
        }
      });
      const ids = evt.options.map((o) => o?.id).filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        errors.push({ path: `timeline[${index}].options`, message: 'option ids must be unique within a variation point' });
      }
    }
  }
}

// Returns { ok, errors, normalized }. `normalized` is safe to persist.
export function validateTimeline(payload, durationSeconds) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: [{ path: '(root)', message: 'body must be a JSON object' }], normalized: null };
  }
  if (!Array.isArray(payload.timeline)) {
    errors.push({ path: 'timeline', message: 'must be an array of timeline events' });
  }
  if (!isFiniteNumber(durationSeconds) || durationSeconds <= 0) {
    errors.push({ path: 'durationSeconds', message: 'title duration must be a positive number' });
  }
  const normalized = [];
  if (!errors.length) {
    payload.timeline.forEach((evt, i) => {
      const before = errors.length;
      const clean = { ...evt };
      // Content text is authored, not generated — sanitize but never rewrite.
      for (const field of ['text', 'term', 'definition', 'characterName', 'characterId']) {
        if (typeof clean[field] === 'string') clean[field] = clean[field].trim().slice(0, 2000);
      }
      validateEvent(clean, i, durationSeconds, errors);
      if (errors.length === before) normalized.push(clean);
    });
    const ids = payload.timeline.map((e) => e?.variationId).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      errors.push({ path: 'timeline', message: 'variationId values must be unique across the timeline' });
    }
  }
  return { ok: errors.length === 0, errors, normalized: errors.length ? null : normalized };
}

export const TIMELINE_EVENT_TYPES = EVENT_TYPES;
