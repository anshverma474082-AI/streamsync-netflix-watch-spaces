import { buildModel, evaluatePrecisionAtK } from '../src/ai/recommender.js';

const titles = [
  { id: 't1', name: 'Comedy Ride', genres: ['comedy', 'family'], durationSeconds: 600 },
  { id: 't2', name: 'Star Machine', genres: ['sci-fi', 'action'], durationSeconds: 900 },
  { id: 't3', name: 'Dragon Vale', genres: ['fantasy', 'adventure'], durationSeconds: 1200 },
  { id: 't4', name: 'Lab Rats', genres: ['sci-fi', 'comedy'], durationSeconds: 500 },
];

const interactions = [
  { userId: 'u1', titleId: 't2', watchedSeconds: 900, rating: 5, preferences: { genreAffinity: ['sci-fi', 'action'] } },
  { userId: 'u1', titleId: 't4', watchedSeconds: 480, rating: 4, preferences: { genreAffinity: ['sci-fi', 'action'] } },
  { userId: 'u2', titleId: 't2', watchedSeconds: 800, rating: 4.5, preferences: { genreAffinity: ['sci-fi'] } },
  { userId: 'u2', titleId: 't3', watchedSeconds: 300, rating: 3, preferences: { genreAffinity: ['sci-fi'] } },
  { userId: 'u3', titleId: 't1', watchedSeconds: 600, rating: 5, preferences: { genreAffinity: ['comedy', 'family'] } },
];

const data = { titles, interactions };

describe('hybrid recommender', () => {
  const model = buildModel(data);

  test('excludes already-watched titles from the rail', () => {
    const rail = model.rank('u1', { topN: 10 });
    const ids = rail.map((r) => r.titleId);
    expect(ids).not.toContain('t2');
    expect(ids).not.toContain('t4');
    expect(ids.sort()).toEqual(['t1', 't3']);
  });

  test('content signal favours genre-affinity matches', () => {
    const rail = model.rank('u3', { topN: 10 });
    const lab = rail.find((r) => r.titleId === 't4');
    const vale = rail.find((r) => r.titleId === 't3');
    expect(lab.contentScore).toBeGreaterThan(vale.contentScore);
  });

  test('collaborative signal fires from co-viewer overlap', () => {
    const rail = model.rank('u1', { topN: 10 });
    const vale = rail.find((r) => r.titleId === 't3');
    expect(vale.collabScore).toBeGreaterThan(0);
    expect(vale.reasons.join(' ')).toMatch(/viewers whose history overlaps/i);
  });

  test('cold-start viewer gets the documented fallback reason, not an error', () => {
    const rail = model.rank('u99', { topN: 3 });
    expect(rail.length).toBeGreaterThan(0);
    expect(rail[0].reasons.join(' ')).toMatch(/catalog .*fallback/i);
  });

  test('scores stay in [0,1] and rail is sorted descending', () => {
    for (const r of model.rank('u2', { topN: 10 })) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    const scores = model.rank('u1', { topN: 10 }).map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test('leave-one-out precision@K evaluates without crashing', () => {
    const result = evaluatePrecisionAtK(data, 3);
    expect(result).toHaveProperty('precision');
    expect(result.k).toBe(3);
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.precision).toBeGreaterThan(0);
  });
});
