import { validateTimeline, TIMELINE_EVENT_TYPES } from '../src/utils/timelineSchema.js';

describe('timeline ingest schema (pre-authored content only)', () => {
  test('accepts a valid mixed timeline and normalizes strings', () => {
    const r = validateTimeline(
      {
        timeline: [
          { ts: 10, type: 'scene', text: '  Opening shot. ' },
          { ts: 20, type: 'character', characterName: 'Zed', text: 'Zed enters.' },
          { ts: 30, type: 'glossary', term: 'Warp', definition: 'Faster than light.' },
          { ts: 40, type: 'variationPoint', variationId: 'v1', text: 'Pick a line', options: [{ id: 'a', label: 'A', text: 'ay' }, { id: 'b', label: 'B', text: 'bee' }] },
        ],
      },
      300
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.normalized[0].text).toBe('Opening shot.');
  });

  test('rejects events outside the title duration with per-path errors', () => {
    const r = validateTimeline({ timeline: [{ ts: 999, type: 'scene', text: 'later' }] }, 300);
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toMatch(/timeline\[0\]\.ts/);
  });

  test('rejects unknown event types', () => {
    const r = validateTimeline({ timeline: [{ ts: 5, type: 'karaoke', text: 'x' }] }, 300);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path.endsWith('.type'))).toBe(true);
    expect(r.errors[0].message).toContain(TIMELINE_EVENT_TYPES.join(', '));
  });

  test('character events need a name; glossary needs term + definition', () => {
    const r = validateTimeline(
      {
        timeline: [
          { ts: 5, type: 'character', text: 'no name here' },
          { ts: 6, type: 'glossary', term: 'OnlyTerm' },
        ],
      },
      300
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path.includes('characterName'))).toBe(true);
    expect(r.errors.some((e) => e.path.includes('definition'))).toBe(true);
  });

  test('variation points require unique ids and 1-6 options', () => {
    const r = validateTimeline(
      {
        timeline: [
          { ts: 5, type: 'variationPoint', text: 'no id', options: [{ id: 'a', label: 'A', text: 'x' }] },
          { ts: 6, type: 'variationPoint', variationId: 'v2', text: 'no options', options: [] },
          { ts: 7, type: 'variationPoint', variationId: 'v2', text: 'dupe id', options: [{ id: 'a', label: 'A', text: 'x' }] },
        ],
      },
      300
    );
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  test('non-array payloads are rejected outright', () => {
    const r = validateTimeline({ timeline: 'nope' }, 300);
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe('timeline');
  });

  test('active spans require fromTs <= toTs', () => {
    const r = validateTimeline(
      { timeline: [{ ts: 5, type: 'character', characterName: 'Z', text: 'hi', fromTs: 50, toTs: 10 }] },
      300
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /fromTs|toTs/.test(e.path))).toBe(true);
  });
});
