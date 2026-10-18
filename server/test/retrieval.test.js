import { retrieve, resolveVariationPoint } from '../src/ai/retrieval.js';

const title = {
  name: 'Test Toon',
  durationSeconds: 600,
  timeline: [
    { ts: 56, type: 'character', characterId: 'c_bunny', characterName: 'Big Buck Bunny', text: 'Big Buck Bunny, the large good-natured rabbit, wakes up in his burrow.' },
    { ts: 91, type: 'glossary', term: 'Blender', definition: 'The free open-source 3D creation suite used to make this film.' },
    { ts: 162, type: 'character', characterId: 'c_frank', characterName: 'Frank', text: 'Frank the fist-sized red squirrel, leader of the three bullies, throws the coconut.' },
    { ts: 178, type: 'trivia', text: 'The bullies were animated with exaggerated proportions.' },
    { ts: 300, type: 'scene', text: 'The butterfly is caught by Gamera with a web trap.' },
    { ts: 338, type: 'character', characterId: 'c_gamera', characterName: 'Gamera', text: 'Gamera, the gray flying rodent with a web-slinging device.' },
    {
      ts: 405,
      type: 'variationPoint',
      variationId: 'v_02',
      text: 'Hindi subtitle pack for the confrontation scene.',
      options: [
        { id: 'a', label: 'Literal', text: 'अब बदले का समय है।' },
        { id: 'b', label: 'Idiomatic', text: 'अब हिसाब बराबर का!' },
      ],
    },
  ],
};

describe('grounded retrieval — no fabrication', () => {
  test('answers a character question inside the window with citations', () => {
    const r = retrieve({ title, question: 'who is Frank?', positionSeconds: 170 });
    expect(r.grounded).toBe(true);
    expect(r.answer).toContain('Frank');
    expect(r.sourceEvents.length).toBeGreaterThan(0);
    expect(r.sourceEvents[0].ts).toBe(162);
    expect(r.matchedTs).toBe(162);
  });

  test('refuses when the answer is outside the retrieval window (no guessing)', () => {
    const r = retrieve({ title, question: 'who is Frank?', positionSeconds: 5 });
    expect(r.grounded).toBe(false);
    expect(r.sourceEvents).toEqual([]);
    expect(r.answer).toMatch(/won't guess|Nothing in the/i);
  });

  test('refuses questions about facts that do not exist in the timeline at all', () => {
    const r = retrieve({ title, question: 'who is the dragon Zaroth?', positionSeconds: 170 });
    expect(r.grounded).toBe(false);
    expect(r.answer).not.toMatch(/dragon/i);
  });

  test('glossary entries answer term questions', () => {
    const r = retrieve({ title, question: 'what is blender?', positionSeconds: 95 });
    expect(r.grounded).toBe(true);
    expect(r.answer).toMatch(/open-source 3D/i);
  });

  test('small lookahead covers a marker just ahead of the playhead', () => {
    const r = retrieve({ title, question: 'who is Gamera?', positionSeconds: 330 });
    expect(r.grounded).toBe(true);
    expect(r.matchedTs).toBe(338);
  });

  test('empty-ish questions get a clarification refusal', () => {
    const r = retrieve({ title, question: 'the and for', positionSeconds: 100 });
    expect(r.grounded).toBe(false);
  });

  test('verbosity changes answer length but never invents content', () => {
    const minimal = retrieve({ title, question: 'who is Frank?', positionSeconds: 170, verbosity: 'minimal' });
    const chatty = retrieve({ title, question: 'who is Frank?', positionSeconds: 170, verbosity: 'chatty' });
    expect(minimal.answer.length).toBeLessThanOrEqual(chatty.answer.length);
    expect(chatty.grounded && minimal.grounded).toBe(true);
  });

  test('answers are fast (search-based, in-memory)', () => {
    const started = performance.now();
    for (let i = 0; i < 500; i += 1) retrieve({ title, question: 'who is Frank?', positionSeconds: 170 });
    const perCall = (performance.now() - started) / 500;
    expect(perCall).toBeLessThan(2);
  });
});

describe('variation points', () => {
  test('resolveVariationPoint finds pre-authored options by id', () => {
    const vp = resolveVariationPoint(title, 'v_02');
    expect(vp.options.map((o) => o.id)).toEqual(['a', 'b']);
    expect(resolveVariationPoint(title, 'nope')).toBeNull();
  });
});
