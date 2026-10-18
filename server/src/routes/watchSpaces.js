import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import Title from '../models/Title.js';
import WatchSpace from '../models/WatchSpace.js';
import { HttpError, requireRole } from '../middleware/auth.js';
import { generateInviteCode } from '../utils/inviteCode.js';
import { retrieve } from '../ai/retrieval.js';
import { sanitizeText } from '../utils/text.js';

const router = Router();

async function uniqueInviteCode() {
  for (let i = 0; i < 5; i += 1) {
    const code = generateInviteCode();
    if (!(await WatchSpace.exists({ inviteCode: code }))) return code;
  }
  throw new HttpError(500, 'Could not allocate invite code');
}

router.post(
  '/',
  requireRole('host', 'admin'),
  body('titleId').custom((v) => mongoose.isValidObjectId(v)),
  body('roomName').optional().isString().isLength({ max: 80 }),
  body('maxParticipants').optional().isInt({ min: 2, max: 50 }),
  body('aiVerbosity').optional().isIn(['minimal', 'normal', 'chatty']),
  body('votingEnabled').optional().isBoolean(),
  body('triviaEnabled').optional().isBoolean(),
  body('isLocked').optional().isBoolean(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new HttpError(422, 'Validation failed', errors.array()));
    const title = await Title.findById(req.body.titleId);
    if (!title) return next(new HttpError(404, 'Title not found'));
    const inviteCode = await uniqueInviteCode();
    const ws = await WatchSpace.create({
      titleId: title._id,
      hostUserId: req.user._id,
      inviteCode,
      roomName: req.body.roomName ?? `${req.user.displayName}'s watch space`,
      status: 'scheduled',
      participants: [{ userId: req.user._id, joinedAt: new Date() }],
      settings: {
        maxParticipants: req.body.maxParticipants ?? 25,
        aiVerbosity: req.body.aiVerbosity ?? 'normal',
        votingEnabled: req.body.votingEnabled ?? true,
        triviaEnabled: req.body.triviaEnabled ?? true,
        isLocked: req.body.isLocked ?? false,
      },
    });
    res.status(201).json({
      watchSpaceId: ws._id.toString(),
      inviteCode: ws.inviteCode,
      status: ws.status,
      hostUserId: ws.hostUserId.toString(),
      createdAt: ws.createdAt,
    });
  }
);

router.get('/invite/:code', async (req, res, next) => {
  const ws = await WatchSpace.findOne({ inviteCode: req.params.code.toUpperCase() }).lean();
  if (!ws) return next(new HttpError(404, 'No watch space for this invite code'));
  const title = await Title.findById(ws.titleId).select('name posterUrl durationSeconds').lean();
  res.json({ watchSpaceId: ws._id, status: ws.status, roomName: ws.roomName, title });
});

router.get('/:id', async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new HttpError(404, 'Watch space not found'));
  const ws = await WatchSpace.findById(req.params.id).lean();
  if (!ws) return next(new HttpError(404, 'Watch space not found'));
  const title = await Title.findById(ws.titleId).select('name posterUrl durationSeconds videoAssetUrl').lean();
  res.json({ watchSpace: { ...ws, title } });
});

router.post(
  '/:id/ai/ask',
  body('question').isString().trim().isLength({ min: 2, max: 400 }),
  body('positionSeconds').optional().isFloat({ min: 0 }),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new HttpError(422, 'Validation failed', errors.array()));
    if (!mongoose.isValidObjectId(req.params.id)) return next(new HttpError(404, 'Watch space not found'));
    const ws = await WatchSpace.findById(req.params.id).lean();
    if (!ws) return next(new HttpError(404, 'Watch space not found'));
    const title = await Title.findById(ws.titleId).lean();
    if (!title) return next(new HttpError(404, 'Title not found'));
    const question = sanitizeText(req.body.question).slice(0, 400);
    const positionSeconds = Number(req.body.positionSeconds ?? 0);
    const verbosity = ws.settings?.aiVerbosity ?? 'normal';
    const startedAt = Date.now();
    const result = retrieve({ title, question, positionSeconds, verbosity });
    res.json({
      watchSpaceId: ws._id,
      question,
      positionSeconds,
      titleId: title._id,
      latencyMs: Date.now() - startedAt,
      ...result,
    });
  }
);

router.post('/:id/end', requireRole('host', 'admin'), async (req, res, next) => {
  const ws = await WatchSpace.findById(req.params.id);
  if (!ws) return next(new HttpError(404, 'Watch space not found'));
  if (ws.hostUserId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new HttpError(403, 'Only the host can end this session'));
  }
  if (ws.status === 'ended') return next(new HttpError(409, 'Session already ended'));
  ws.status = 'ended';
  ws.endedAt = new Date();
  ws.summary = {
    durationSeconds: ws.startedAt ? Math.round((Date.now() - ws.startedAt.getTime()) / 1000) : 0,
    peakParticipants: ws.participants.length,
    aiQuestionsAsked: 0,
    triviaSurfaced: 0,
    chatVolume: 0,
  };
  await ws.save();
  res.json({ watchSpaceId: ws._id, status: ws.status, summary: ws.summary });
});

router.get('/', async (req, res) => {
  const live = await WatchSpace.find({ status: { $in: ['scheduled', 'live'] } })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('titleId', 'name posterUrl')
    .lean();
  res.json({
    rooms: live.map((r) => ({
      watchSpaceId: r._id,
      roomName: r.roomName,
      inviteCode: r.inviteCode,
      status: r.status,
      participantCount: r.participants.length,
      title: r.titleId,
    })),
  });
});

export default router;
