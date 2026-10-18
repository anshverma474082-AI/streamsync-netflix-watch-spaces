import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import Title from '../models/Title.js';
import Interaction from '../models/Interaction.js';
import WatchSpace from '../models/WatchSpace.js';
import ChatMessage from '../models/ChatMessage.js';
import { HttpError, requireRole } from '../middleware/auth.js';
import { buildModel, evaluatePrecisionAtK, loadTrainingData } from '../ai/recommender.js';

const router = Router();

// The rail is served from an in-process model so a retrain is O(1) for readers;
// it self-trains on first use and is explicitly rebuilt by the retrain endpoint.
let model = null;
let modelMeta = { trainedAt: null, interactionCount: 0, viewerCount: 0 };

async function ensureModel({ force = false } = {}) {
  if (model && !force) return model;
  const data = await loadTrainingData();
  model = buildModel(data);
  modelMeta = { trainedAt: model.trainedAt, interactionCount: model.interactionCount, viewerCount: model.viewerCount };
  return model;
}

router.get('/me', query('limit').optional().isInt({ min: 1, max: 20 }), async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(new HttpError(422, 'limit must be an integer between 1 and 20', errors.array()));
  const m = await ensureModel();
  const limit = Number(req.query.limit ?? 5);
  res.json({
    generatedAt: new Date().toISOString(),
    model: modelMeta,
    recommendations: m.rank(req.user.id, { topN: limit }),
  });
});

router.post(
  '/me/ratings',
  body('titleId').custom((v) => mongoose.isValidObjectId(v)),
  body('rating').isFloat({ min: 0, max: 5 }),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new HttpError(422, 'Validation failed', errors.array()));
    const title = await Title.findById(req.body.titleId).select('_id').lean();
    if (!title) return next(new HttpError(404, 'Title not found'));
    const existing = await Interaction.findOne({ userId: req.user.id, titleId: title._id });
    const row =
      existing ??
      new Interaction({
        userId: req.user.id,
        titleId: title._id,
        watchedSeconds: 0,
        coWatchedWith: [],
      });
    row.rating = req.body.rating;
    row.lastWatchedAt = new Date();
    if (!existing) row.watchedSeconds = Math.max(row.watchedSeconds, 1);
    await row.save();
    await ensureModel({ force: true });
    res.json({ interaction: row });
  },
);

router.get('/me/interactions', async (req, res) => {
  const rows = await Interaction.find({ userId: req.user.id })
    .sort({ lastWatchedAt: -1, updatedAt: -1 })
    .populate('titleId', 'name genres durationSeconds posterUrl')
    .lean();
  res.json({
    interactions: rows.map((r) => ({
      id: r._id,
      title: r.titleId,
      watchedSeconds: r.watchedSeconds,
      completed: r.completed,
      rating: r.rating ?? null,
      coWatchedWith: r.coWatchedWith,
      lastWatchedAt: r.lastWatchedAt,
    })),
  });
});

// Offline retrain — the rail refreshes without a redeploy. Returns the measured
// leave-one-out precision@K of the model it just built.
router.post('/retrain', requireRole('admin'), async (req, res) => {
  const data = await loadTrainingData();
  model = buildModel(data);
  modelMeta = { trainedAt: model.trainedAt, interactionCount: model.interactionCount, viewerCount: model.viewerCount };
  const evaluation = evaluatePrecisionAtK(data, 5);
  res.json({ ...modelMeta, evaluation });
});

// Session analytics reconciled against the persisted event log: the in-memory
// summary the room broadcast is compared with what actually landed in Mongo.
router.get('/analytics/sessions', requireRole('admin'), async (req, res) => {
  const spaces = await WatchSpace.find({ status: 'ended' })
    .sort({ endedAt: -1 })
    .limit(50)
    .lean();
  const sessions = await Promise.all(
    spaces.map(async (space) => {
      const [chatCount, interactionCount] = await Promise.all([
        ChatMessage.countDocuments({ watchSpaceId: space._id, msgType: 'chat' }),
        Interaction.countDocuments({ watchSpaceId: space._id }),
      ]);
      const summary = space.summary ?? {};
      return {
        watchSpaceId: space._id,
        roomName: space.roomName,
        titleId: space.titleId,
        endedAt: space.endedAt,
        summary,
        persisted: {
          chatVolume: chatCount,
          participantsRecorded: interactionCount,
        },
        reconciled: {
          chatVolume: (summary.chatVolume ?? 0) === chatCount,
          participants: (summary.participants?.length ?? 0) === interactionCount,
        },
      };
    }),
  );
  res.json({ sessions, model: modelMeta });
});

export default router;
