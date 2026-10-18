import { tokenize } from '../utils/text.js';

// Search-based, fully-grounded retrieval over a title's authored timeline.
// No LLM: an answer is assembled ONLY from metadata already ingested for this
// title, and every answer cites the exact timeline entries it drew from. This
// keeps Epic 2 verifiable and satisfies the PRD rule that the co-pilot must
// never fabricate facts absent from the ingested metadata.

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'what', 'when', 'where', 'which',
  'who', 'whom', 'why', 'how', 'does', 'did', 'is', 'are', 'was', 'were', 'been',
  'have', 'has', 'had', 'you', 'your', 'they', 'their', 'about', 'can', 'could',
  'would', 'should', 'will', 'just', 'some', 'any', 'all', 'not', 'but', 'get',
  'please', 'tell', 'me', 'him', 'her', 'his', 'she', 'he', 'it', 'its', 'there',
]);

const TYPE_PRIOR = {
  glossary: 1.25,
  character: 1.2,
  trivia: 1.15,
  scene: 1.0,
  variationPoint: 0.9,
};

// Retrieval window: mostly the current + preceding action (PRD), with a small
// lookahead so a marker a fraction of a second ahead still answers "what
// happens next?" style questions.
const LOOKBEHIND_SECONDS = 90;
const LOOKAHEAD_SECONDS = 15;
const MIN_SCORE = 0.34;

function contentTokens(text) {
  return tokenize(String(text ?? '')).filter((w) => !STOPWORDS.has(w));
}

function eventCorpus(evt) {
  return contentTokens(`${evt.text} ${evt.term} ${evt.definition} ${evt.characterName} ${evt.type}`);
}

function withinWindow(evt, positionSeconds) {
  if (evt.ts > positionSeconds + LOOKAHEAD_SECONDS) return false;
  if (evt.ts < positionSeconds - LOOKBEHIND_SECONDS) return false;
  return true;
}

// A character-appearance or glossary entry "owns" a span of the timeline; an
// explicit characterId/term mention should surface even a slightly older entry.
function activeSpan(evt, positionSeconds) {
  if (evt.fromTs != null && evt.toTs != null) {
    return positionSeconds >= evt.fromTs - 5 && positionSeconds <= evt.toTs + 5;
  }
  return withinWindow(evt, positionSeconds);
}

function proximityBoost(evt, positionSeconds) {
  const delta = Math.abs(positionSeconds - evt.ts);
  if (delta <= 10) return 1.0;
  if (delta <= 30) return 0.75;
  if (delta <= 60) return 0.55;
  return 0.4;
}

function scoreEvent(evt, queryTokens, positionSeconds) {
  const corpus = eventCorpus(evt);
  if (!corpus.length) return { score: 0, matched: [] };
  const corpusSet = new Set(corpus);
  const matched = queryTokens.filter((t) => corpusSet.has(t));
  if (!matched.length) return { score: 0, matched: [] };
  // Coverage of the question by the entry, weighted by type prior, authored
  // weight, and how close the entry is to the current playhead.
  const coverage = matched.length / queryTokens.length;
  const partialMatchFloor = Math.min(1, matched.length / Math.max(2, queryTokens.length));
  const base = Math.max(coverage, partialMatchFloor * 0.9);
  const prior = TYPE_PRIOR[evt.type] ?? 1;
  const weight = evt.weight ?? 1;
  const boost = activeSpan(evt, positionSeconds) ? proximityBoost(evt, positionSeconds) : proximityBoost(evt, positionSeconds) * 0.5;
  const matchedRarityBonus = matched.length > 1 ? 0.15 * (matched.length - 1) : 0;
  return { score: base * prior * weight * boost + matchedRarityBonus, matched };
}

function citation(evt) {
  return {
    ts: evt.ts,
    type: evt.type,
    text: evt.text ?? (evt.term ? `${evt.term}: ${evt.definition ?? ''}`.trim() : ''),
    characterName: evt.characterName,
    term: evt.term,
  };
}

function composeAnswer(top, supporting, verbosity) {
  const lead = top.text || (top.term ? `${top.term} — ${top.definition}` : top.characterName) || top.definition;
  const label =
    top.type === 'character' ? `${top.characterName}: `
      : top.type === 'glossary' ? ''
        : '';
  const head = `${label}${lead}`.trim();
  if (verbosity === 'minimal' || !supporting.length) return head;
  const extra = supporting
    .slice(0, verbosity === 'chatty' ? 2 : 1)
    .map((e) => e.text || (e.term ? `${e.term} (${e.definition})` : ''))
    .filter(Boolean)
    .join(' ');
  return extra ? `${head} ${extra}`.replace(/\s+/g, ' ').trim() : head;
}

export function retrieve({ title, question, positionSeconds = 0, verbosity = 'normal' }) {
  const timeline = Array.isArray(title.timeline) ? title.timeline : [];
  const queryTokens = contentTokens(question);
  if (!queryTokens.length) {
    return { grounded: false, answer: 'I need a bit more to go on — try naming a character, term, or moment.', sourceEvents: [], matchedTs: null };
  }

  const scored = timeline
    .map((evt) => ({ evt, ...scoreEvent(evt, queryTokens, positionSeconds) }))
    .filter((r) => r.score >= MIN_SCORE && withinWindow(r.evt, positionSeconds))
    .sort((a, b) => b.score - a.score || Math.abs(a.evt.ts - positionSeconds) - Math.abs(b.evt.ts - positionSeconds));

  if (!scored.length) {
    return {
      grounded: false,
      answer: `Nothing in the ${title.name} timeline answers that at ${fmtClock(positionSeconds)}. I only speak from this title's authored metadata, so I won't guess.`,
      sourceEvents: [],
      matchedTs: null,
    };
  }

  const [top, ...rest] = scored;
  const supporting = rest
    .filter((r) => r.evt.type !== top.evt.type || Math.abs(r.evt.ts - top.evt.ts) > 8)
    .map((r) => r.evt);
  const cited = [top.evt, ...supporting.slice(0, verbosity === 'minimal' ? 0 : 2)];

  return {
    grounded: true,
    answer: composeAnswer(top.evt, supporting, verbosity),
    sourceEvents: cited.map(citation),
    matchedTs: top.evt.ts,
    confidence: Number(Math.min(1, top.score).toFixed(2)),
  };
}

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function resolveVariationPoint(title, variationId) {
  return (title.timeline ?? []).find((e) => e.type === 'variationPoint' && e.variationId === variationId) ?? null;
}
