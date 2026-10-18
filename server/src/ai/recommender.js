import Title from '../models/Title.js';
import User from '../models/User.js';
import Interaction from '../models/Interaction.js';

// Hybrid recommender, plain JS, no external ML service.
//   content-based  — cosine between the viewer's genre-affinity vector and a
//                    title's genre vector, nudged by what they rated and
//                    watched far into.
//   collaborative  — item-item similarity learned from which titles viewers
//                    engaged with together, scored against this viewer's
//                    history.
// Both signals are normalised to [0,1] before blending, so a cold start on one
// does not silence the other. The model lives in process memory and is rebuilt
// by the admin retrain endpoint — no redeploy to refresh a rail.

const CONTENT_WEIGHT = 0.45;
const COLLAB_WEIGHT = 0.55;

function norm(vec) {
  const mag = Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
  if (!mag) return vec;
  return Object.fromEntries(Object.entries(vec).map(([k, v]) => [k, v / mag]));
}

function cosine(a, b) {
  let dot = 0;
  for (const [k, v] of Object.entries(a)) dot += v * (b[k] ?? 0);
  return dot;
}

function maxNormalise(pairs) {
  const max = Math.max(0, ...pairs.map(([, score]) => score));
  return new Map(pairs.map(([id, score]) => [id, max > 0 ? score / max : 0]));
}

export function buildModel({ titles, interactions }) {
  const titleById = new Map(titles.map((t) => [t.id, t]));
  const genreVectors = new Map(
    titles.map((t) => [t.id, norm(Object.fromEntries((t.genres ?? []).map((g) => [String(g).toLowerCase(), 1])))]),
  );

  const profiles = new Map();
  for (const row of interactions) {
    const title = titleById.get(String(row.titleId));
    if (!title) continue;
    const key = String(row.userId);
    const profile = profiles.get(key) ?? { affinity: {}, learned: {}, seen: new Set() };
    for (const genre of row.preferences?.genreAffinity ?? []) {
      const g = String(genre).toLowerCase();
      profile.affinity[g] = (profile.affinity[g] ?? 0) + 1;
    }
    const signal =
      (row.rating != null ? Math.max(0, row.rating - 2.5) / 2.5 : 0) +
      Math.min(1, (row.watchedSeconds ?? 0) / Math.max(1, title.durationSeconds));
    if (signal > 0) {
      for (const genre of title.genres ?? []) {
        const g = String(genre).toLowerCase();
        profile.learned[g] = (profile.learned[g] ?? 0) + signal;
      }
    }
    profile.seen.add(title.id);
    profiles.set(key, profile);
  }

  const sim = new Map();
  const itemNorm = new Map();
  const byUser = new Map();
  for (const row of interactions) {
    const key = String(row.userId);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push({
      titleId: String(row.titleId),
      weight: 0.5 + Math.min(1, (row.watchedSeconds ?? 0) / 1800) / 2 + (row.rating != null ? row.rating / 10 : 0),
    });
  }
  for (const items of byUser.values()) {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        if (items[i].titleId === items[j].titleId) continue;
        const pair = `${items[i].titleId}|${items[j].titleId}`;
        const alt = `${items[j].titleId}|${items[i].titleId}`;
        sim.set(pair, (sim.get(pair) ?? sim.get(alt) ?? 0) + items[i].weight * items[j].weight);
      }
    }
    for (const it of items) itemNorm.set(it.titleId, (itemNorm.get(it.titleId) ?? 0) + it.weight ** 2);
  }
  const similarityOf = (a, b) => {
    if (a === b) return 0;
    const raw = sim.get(`${a}|${b}`) ?? sim.get(`${b}|${a}`) ?? 0;
    if (!raw) return 0;
    return raw / (Math.sqrt(itemNorm.get(a) ?? 1) * Math.sqrt(itemNorm.get(b) ?? 1));
  };

  return {
    trainedAt: new Date().toISOString(),
    interactionCount: interactions.length,
    viewerCount: profiles.size,
    titleById,
    rank(userId, { topN = 5 } = {}) {
      const profile = profiles.get(String(userId));
      const affinity = norm(profile?.affinity ?? {});
      const learned = norm(profile?.learned ?? {});
      const seen = profile?.seen ?? new Set();
      const history = [...seen];

      const candidates = titles.filter((t) => !seen.has(t.id));
      const raw = candidates.map((t) => {
        const vec = genreVectors.get(t.id);
        const content = Math.max(0, 0.7 * cosine(affinity, vec) + 0.3 * cosine(learned, vec));
        let collab = 0;
        for (const anchorId of history) collab += similarityOf(anchorId, t.id);
        return { titleId: t.id, content, collab };
      });
      const contentScores = maxNormalise(raw.map((r) => [r.titleId, r.content]));
      const collabScores = maxNormalise(raw.map((r) => [r.titleId, r.collab]));

      return candidates
        .map((t) => {
          const contentScore = contentScores.get(t.id) ?? 0;
          const collabScore = collabScores.get(t.id) ?? 0;
          const reasons = [];
          const genreHits = (t.genres ?? []).filter((g) => affinity[String(g).toLowerCase()] || learned[String(g).toLowerCase()]);
          if (contentScore > 0.05 && genreHits.length) {
            reasons.push(`matches your affinity for ${genreHits.join(', ')}`);
          }
          if (collabScore > 0.05) {
            reasons.push(`picked by viewers whose history overlaps yours (${history.length} anchor${history.length === 1 ? '' : 's'} in your watch log)`);
          }
          if (!reasons.length) reasons.push('catalog fallback — your watch log is too thin to personalise yet');
          return {
            titleId: t.id,
            name: t.name,
            posterUrl: t.posterUrl,
            genres: t.genres,
            durationSeconds: t.durationSeconds,
            contentScore: Number(contentScore.toFixed(3)),
            collabScore: Number(collabScore.toFixed(3)),
            score: Number((CONTENT_WEIGHT * contentScore + COLLAB_WEIGHT * collabScore).toFixed(4)),
            reasons,
          };
        })
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, topN);
    },
  };
}

export async function loadTrainingData() {
  const [titles, interactions, users] = await Promise.all([
    Title.find().select('name genres durationSeconds posterUrl').lean(),
    Interaction.find().lean(),
    User.find().select('preferences').lean(),
  ]);
  const prefs = new Map(users.map((u) => [String(u._id), u.preferences ?? {}]));
  return {
    titles: titles.map((t) => ({ ...t, id: String(t._id) })),
    interactions: interactions.map((row) => ({ ...row, preferences: prefs.get(String(row.userId)) ?? {} })),
  };
}

// Leave-one-out precision@K: for every viewer with 2+ recorded interactions,
// hide one title, retrain on what remains, and check whether the model puts the
// hidden title inside the top K.
export function evaluatePrecisionAtK({ titles, interactions }, k = 5) {
  const byUser = new Map();
  for (const row of interactions) {
    const key = String(row.userId);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(row);
  }
  let evaluated = 0;
  let hits = 0;
  for (const [userId, rows] of byUser) {
    if (rows.length < 2) continue;
    const heldOut = String(rows[rows.length - 1].titleId);
    const visible = rows.filter((r) => String(r.titleId) !== heldOut);
    evaluated += 1;
    const fold = buildModel({ titles, interactions: visible });
    if (fold.rank(userId, { topN: k }).some((r) => r.titleId === heldOut)) hits += 1;
  }
  return { k, evaluated, hits, precision: evaluated ? Number((hits / evaluated).toFixed(3)) : 0 };
}
