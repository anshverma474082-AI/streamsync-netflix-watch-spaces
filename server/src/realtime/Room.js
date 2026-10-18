import { RoomClock } from './clock.js';
import ChatMessage from '../models/ChatMessage.js';
import WatchSpace from '../models/WatchSpace.js';
import Interaction from '../models/Interaction.js';
import { sanitizeText } from '../utils/text.js';
import { retrieve, resolveVariationPoint } from '../ai/retrieval.js';

const HOST_RECONNECT_GRACE_MS = 15_000;
const CHAT_FLUSH_INTERVAL_MS = 2_000;
const CHAT_FLUSH_BATCH = 20;
const TRIVIA_TICK_MS = 500;
const HISTORY_LIMIT = 50;
const VOTE_DURATION_MS = 15_000;

export class Room {
  constructor({ io, doc, title, registry }) {
    this.io = io;
    this.registry = registry;
    this.id = doc._id.toString();
    this.room = `ws:${this.id}`;
    this.correlationId = `${this.id}-${Date.now().toString(36)}`;
    this.doc = doc;
    this.title = title;
    this.clock = new RoomClock();
    this.participants = new Map();
    this.hostUserId = doc.hostUserId.toString();
    this.status = 'live';
    this.mutedUntilDisconnect = new Set();
    this.stats = { peakParticipants: 0, aiQuestionsAsked: 0, triviaSurfaced: 0, chatVolume: 0 };
    this.chatBuffer = [];
    this.chatFlushTimer = null;
    this.lastTriviaTs = -1;
    this.triviaTimer = null;
    this.hostDownTimer = null;
    // Narrative-variation voting state (Epic 2).
    this.activeVote = null;
    this.voteTimer = null;
    this.appliedVariations = new Map(); // variationId -> { optionId, text, ts, by: 'vote'|'system' }
    this.pendingApplies = [];
    // Watch-time bookkeeping (Epic 3). Presence and playback spans are
    // accumulated in memory and reconciled to Interaction docs once, at session
    // end — the PRD forbids persisting every playback heartbeat.
    this.playbackSpans = [];
    this.openSpan = null;
    this.votesCast = 0;
    this.variationsApplied = 0;
    this.log('room created');
  }

  log(message, extra = {}) {
    console.log(JSON.stringify({ corr: this.correlationId, ws: this.id, msg: message, ...extra }));
  }

  envelope(event, payload) {
    return { event, watchSpaceId: this.id, payload, ts: Date.now() };
  }

  emit(event, payload) {
    this.io.to(this.room).emit('room.event', this.envelope(event, payload));
  }

  emitTo(socket, event, payload) {
    socket.emit('room.event', this.envelope(event, payload));
  }

  participantCount() {
    return [...this.participants.values()].filter((p) => p.socket && !p.socket.disconnected).length;
  }

  snapshotFor(socket) {
    const isRequesterHost = socket.data.user.id === this.hostUserId;
    return {
      room: {
        watchSpaceId: this.id,
        roomName: this.doc.roomName,
        titleId: this.title._id.toString(),
        titleName: this.title.name,
        videoAssetUrl: this.title.videoAssetUrl,
        durationSeconds: this.title.durationSeconds,
        hostUserId: this.hostUserId,
        status: this.status,
        settings: this.doc.settings,
        inviteCode: isRequesterHost ? this.doc.inviteCode : undefined,
        appliedVariations: [...this.appliedVariations.entries()].map(([variationId, v]) => ({ variationId, ...v })),
      },
      clock: this.clock.snapshot(),
      serverNow: Date.now(),
      participants: this.publicParticipants(),
    };
  }

  publicParticipants() {
    return [...this.participants.entries()].map(([userId, p]) => ({
      userId,
      displayName: p.displayName,
      online: Boolean(p.socket && !p.socket.disconnected),
      connectionQuality: p.connectionQuality ?? 'good',
      muted: Boolean(p.muted),
    }));
  }

  join(socket, user) {
    const existing = this.participants.get(user.id);
    if (existing?.socket && !existing.socket.disconnected && existing.socket.id !== socket.id) {
      return { error: 'ALREADY_IN_ROOM' };
    }
    if (!existing && this.doc.settings.isLocked && user.id !== this.hostUserId) {
      return { error: 'ROOM_LOCKED' };
    }
    if (!existing && this.participantCount() >= this.doc.settings.maxParticipants) {
      return { error: 'ROOM_FULL' };
    }
    if (existing) {
      socket.rooms.has(this.room) || socket.join(this.room);
      existing.socket = socket;
      existing.disconnectedAt = null;
      this.openInterval(user.id);
      this.bindRoomEvents(socket);
      if (user.id === this.hostUserId && this.status === 'host_disconnected') this.restoreHost();
      this.stats.peakParticipants = Math.max(this.stats.peakParticipants, this.participantCount());
      this.emit('room.presence.update', {
        participantId: user.id,
        displayName: user.displayName,
        action: 'rejoined',
        participantCount: this.participantCount(),
      });
      this.emitTo(socket, 'room.snapshot', this.snapshotFor(socket));
      this.pushHistory(socket);
      this.log('resume join', { userId: user.id });
      return { ok: true, resumed: true };
    }
    if (this.doc.settings.isLocked && user.id !== this.hostUserId) return { error: 'ROOM_LOCKED' };
    socket.join(this.room);
    this.participants.set(user.id, {
      socket,
      displayName: user.displayName,
      role: user.role,
      joinedAt: Date.now(),
      muted: this.mutedUntilDisconnect.has(user.id),
      intervals: [{ start: Date.now(), end: null }],
    });
    this.stats.peakParticipants = Math.max(this.stats.peakParticipants, this.participantCount());
    this.bindRoomEvents(socket);
    this.emit('room.presence.update', {
      participantId: user.id,
      displayName: user.displayName,
      action: 'joined',
      participantCount: this.participantCount(),
    });
    this.emitTo(socket, 'room.snapshot', this.snapshotFor(socket));
    this.pushHistory(socket);
    this.systemMessage(`${user.displayName} joined the room`);
    this.log('join', { userId: user.id });
    return { ok: true };
  }

  pushHistory(socket) {
    ChatMessage.find({ watchSpaceId: this.id })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean()
      .then((docs) => {
        this.emitTo(socket, 'room.chat.history', { messages: docs.reverse() });
      });
  }

  bindRoomEvents(socket) {
    socket.on('room.playback.update', (payload) => this.onPlayback(socket, payload));
    socket.on('room.sync.ping', (payload) => this.onSyncPing(socket, payload));
    socket.on('room.chat.send', (payload) => this.onChatSend(socket, payload));
    socket.on('room.chat.typing', (payload) => this.onTyping(socket, payload));
    socket.on('room.chat.react', (payload) => this.onReact(socket, payload));
    socket.on('room.moderation', (payload) => this.onModeration(socket, payload));
    socket.on('room.ai.ask', (payload) => this.onAiAsk(socket, payload));
    socket.on('room.variation.openVote', (payload) => this.onOpenVote(socket, payload));
    socket.on('room.variation.vote', (payload) => this.onCastVote(socket, payload));
    socket.on('room.end', () => this.onEndRequest(socket));
  }

  isHost(socket) {
    const p = this.participants.get(socket.data.user.id);
    return Boolean(p) && socket.data.user.id === this.hostUserId && p.socket === socket;
  }

  onPlayback(socket, payload) {
    if (!this.isHost(socket)) {
      this.emitTo(socket, 'room.error', { code: 'NOT_HOST', message: 'Only the host controls playback' });
      return;
    }
    const allowed = ['playing', 'paused', 'seeking', 'buffering'];
    if (!allowed.includes(payload?.state)) return;
    const prev = this.clock.positionAt();
    const snap = this.clock.set({ state: payload.state, positionSeconds: payload.positionSeconds });
    this.emit('room.playback.update', { ...snap, issuedBy: socket.data.user.id });
    if (snap.state === 'playing') {
      this.startTriviaTicker(prev);
      this.openSpan ??= { start: Date.now() };
    } else {
      this.stopTriviaTicker();
      this.closeSpan();
    }
    this.log('playback', { state: snap.state, pos: snap.positionSeconds?.toFixed(2) });
  }

  closeSpan(nowMs = Date.now()) {
    if (!this.openSpan) return;
    this.playbackSpans.push({ start: this.openSpan.start, end: nowMs });
    this.openSpan = null;
  }

  openInterval(userId) {
    const p = this.participants.get(userId);
    if (!p) return;
    (p.intervals ??= []).push({ start: Date.now(), end: null });
  }

  closeInterval(userId) {
    const p = this.participants.get(userId);
    const open = p?.intervals?.at(-1);
    if (open && open.end === null) open.end = Date.now();
  }

  // Seconds of actual playback this user was present for — the watched-time
  // signal the recommender trains on.
  watchedSecondsFor(userId) {
    const p = this.participants.get(userId);
    if (!p?.intervals) return 0;
    const online = p.intervals.map((i) => [i.start, i.end ?? Date.now()]);
    let ms = 0;
    for (const span of this.playbackSpans) {
      for (const [from, to] of online) {
        ms += Math.max(0, Math.min(span.end, to) - Math.max(span.start, from));
      }
    }
    return Math.round(ms / 1000);
  }

  coWatchedWith(userId) {
    const p = this.participants.get(userId);
    if (!p?.intervals) return [];
    const mine = p.intervals.map((i) => [i.start, i.end ?? Date.now()]);
    const others = [];
    for (const [otherId, q] of this.participants) {
      if (otherId === userId || !q.intervals) continue;
      const theirs = q.intervals.map((i) => [i.start, i.end ?? Date.now()]);
      const overlap = mine.some(([a, b]) => theirs.some(([c, d]) => Math.min(b, d) > Math.max(a, c) + 1000));
      if (overlap) others.push(otherId);
    }
    return others;
  }

  async flushInteractions() {
    this.closeSpan();
    for (const [userId] of this.participants) {
      const sessionWatched = Math.min(this.watchedSecondsFor(userId), this.title.durationSeconds);
      if (sessionWatched <= 0) continue;
      const existing = await Interaction.findOne({ userId, titleId: this.title._id }).lean();
      await Interaction.findOneAndUpdate(
        { userId, titleId: this.title._id },
        {
          $set: {
            // Session minutes add to the lifetime total for this (user, title);
            // a short re-watch must never shrink what the recommender trains on.
            watchedSeconds: (existing?.watchedSeconds ?? 0) + sessionWatched,
            completed: Boolean(existing?.completed) || sessionWatched >= this.title.durationSeconds * 0.9,
            lastWatchedAt: new Date(),
            watchSpaceId: this.id,
          },
          $addToSet: { coWatchedWith: { $each: this.coWatchedWith(userId) } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).catch((err) => this.log('interaction flush failed', { err: err.message }));
    }
  }

  onSyncPing(socket, payload) {
    this.emitTo(socket, 'room.sync.pong', {
      clientSentAt: payload?.clientSentAt,
      serverReceivedAt: Date.now(),
      serverSentAt: Date.now(),
      clock: this.clock.snapshot(),
    });
  }

  onChatSend(socket, payload) {
    const user = socket.data.user;
    const p = this.participants.get(user.id);
    if (p?.muted) {
      this.emitTo(socket, 'room.error', { code: 'MUTED', message: 'You are muted in this room' });
      return;
    }
    const body = sanitizeText(payload?.body).slice(0, 2000);
    if (!body) return;
    const message = {
      _id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      watchSpaceId: this.id,
      userId: user.id,
      msgType: 'chat',
      body,
      tsSeconds: Math.round(this.clock.positionAt() * 10) / 10,
      reactions: [],
      createdAt: new Date(),
    };
    this.emit('room.chat.message', message);
    this.chatBuffer.push({ ...message, __v: 0 });
    this.chatBuffer = this.chatBuffer.filter((m) => m.userId !== message.userId || m._id === message._id);
    this.stats.chatVolume += 1;
    const typingKey = `typing:${user.id}`;
    clearTimeout(socket[typingKey]);
    socket[typingKey] = setTimeout(() => this.emit('room.chat.typing', { userId: user.id, typing: false }), 1500);
    if (this.chatBuffer.length >= CHAT_FLUSH_BATCH) this.flushChat();
    else this.scheduleChatFlush();
  }

  scheduleChatFlush() {
    if (this.chatFlushTimer) return;
    this.chatFlushTimer = setTimeout(() => this.flushChat(), CHAT_FLUSH_INTERVAL_MS);
  }

  flushChat() {
    clearTimeout(this.chatFlushTimer);
    this.chatFlushTimer = null;
    if (!this.chatBuffer.length) return;
    const rows = this.chatBuffer.map(({ _id, userId, msgType, body, tsSeconds, createdAt }) => ({
      watchSpaceId: this.id,
      userId,
      msgType,
      body,
      tsSeconds,
      createdAt,
    }));
    this.chatBuffer = [];
    ChatMessage.insertMany(rows).catch((err) => this.log('chat flush failed', { err: err.message }));
  }

  onAiAsk(socket, payload) {
    const question = sanitizeText(payload?.question).slice(0, 400);
    if (question.length < 2) return;
    const positionSeconds = Number.isFinite(payload?.positionSeconds)
      ? payload.positionSeconds
      : this.clock.positionAt();
    const verbosity = this.doc.settings?.aiVerbosity ?? 'normal';
    const startedAt = Date.now();
    const result = retrieve({ title: this.title, question, positionSeconds, verbosity });
    const answer = {
      questionId: payload?.questionId,
      question,
      positionSeconds,
      askedBy: socket.data.user.id,
      latencyMs: Date.now() - startedAt,
      ...result,
    };
    this.stats.aiQuestionsAsked += 1;
    this.emit('room.ai.answer', answer);
    this.log('ai.ask', { by: socket.data.user.id, grounded: answer.grounded, latencyMs: answer.latencyMs });
  }

  onOpenVote(socket, payload) {
    if (!this.isHost(socket)) {
      this.emitTo(socket, 'room.error', { code: 'NOT_HOST', message: 'Only the host can open a variation vote' });
      return;
    }
    if (!this.doc.settings?.votingEnabled) {
      this.emitTo(socket, 'room.error', { code: 'VOTING_DISABLED', message: 'Group variation voting is disabled for this room' });
      return;
    }
    const point = resolveVariationPoint(this.title, payload?.variationId);
    if (!point || !Array.isArray(point.options) || point.options.length < 2) {
      this.emitTo(socket, 'room.error', { code: 'BAD_VARIATION', message: 'Unknown or single-option variation point' });
      return;
    }
    if (this.activeVote) clearTimeout(this.voteTimer);
    this.activeVote = {
      variationId: point.variationId,
      ts: point.ts,
      options: point.options.map((o) => ({ id: o.id, label: o.label, text: o.text })),
      tally: Object.fromEntries(point.options.map((o) => [o.id, 0])),
      voters: new Set(),
    };
    this.emit('room.variation.voteOpen', {
      variationId: point.variationId,
      ts: point.ts,
      text: point.text,
      options: this.activeVote.options,
      durationMs: VOTE_DURATION_MS,
    });
    this.voteTimer = setTimeout(() => this.closeVote(), VOTE_DURATION_MS);
    this.log('variation.voteOpen', { variationId: point.variationId });
  }

  onCastVote(socket, payload) {
    const vote = this.activeVote;
    if (!vote) {
      this.emitTo(socket, 'room.error', { code: 'NO_ACTIVE_VOTE', message: 'No variation vote is currently open' });
      return;
    }
    const optionId = payload?.optionId;
    if (!Object.prototype.hasOwnProperty.call(vote.tally, optionId)) return;
    const userId = socket.data.user.id;
    if (vote.voters.has(userId)) return;
    vote.voters.add(userId);
    vote.tally[optionId] += 1;
    this.votesCast += 1;
    this.emitTo(socket, 'room.variation.voteAck', { variationId: vote.variationId, optionId });
  }

  emitApplied(applied) {
    this.variationsApplied += 1;
    this.emit('room.variation.applied', applied);
  }

  closeVote() {
    const vote = this.activeVote;
    if (!vote) return;
    const entries = Object.entries(vote.tally);
    const maxVotes = Math.max(...entries.map(([, n]) => n));
    const winner = vote.options.find((o) => vote.tally[o.id] === maxVotes);
    const applied = { variationId: vote.variationId, optionId: winner.id, text: winner.text ?? winner.label, ts: vote.ts, by: 'vote' };
    this.appliedVariations.set(vote.variationId, applied);
    this.emit('room.variation.voteClosed', { variationId: vote.variationId, tally: vote.tally, totalVotes: vote.voters.size, winnerOptionId: winner.id });
    this.scheduleApply(applied);
    this.activeVote = null;
    this.voteTimer = null;
    this.log('variation.closed', { variationId: vote.variationId, winner: winner.id, votes: vote.voters.size });
  }

  // "Applied identically and simultaneously to all connected clients" at the
  // authored playback point: apply immediately if the room already crossed the
  // marker, otherwise let the playback ticker fire it for everyone at the ts.
  scheduleApply(applied) {
    const pos = this.clock.positionAt();
    if (pos >= applied.ts - 0.25) {
      this.emitApplied(applied);
      return;
    }
    this.pendingApplies = (this.pendingApplies ?? []).filter((p) => p.variationId !== applied.variationId);
    this.pendingApplies.push(applied);
  }

  flushPendingApplies(pos) {
    if (!this.pendingApplies?.length) return;
    const ready = this.pendingApplies.filter((p) => pos >= p.ts - 0.1);
    if (!ready.length) return;
    this.pendingApplies = this.pendingApplies.filter((p) => pos < p.ts - 0.1);
    ready.forEach((p) => this.emitApplied(p));
  }

  onTyping(socket, payload) {
    this.emit('room.chat.typing', { userId: socket.data.user.id, displayName: socket.data.user.displayName, typing: Boolean(payload?.typing) });
  }

  onReact(socket, payload) {
    const emoji = sanitizeText(payload?.emoji).slice(0, 8);
    if (!emoji || !payload?.messageId) return;
    this.emit('room.chat.reaction', { messageId: payload.messageId, userId: socket.data.user.id, emoji });
  }

  onModeration(socket, payload) {
    if (!this.isHost(socket)) {
      this.emitTo(socket, 'room.error', { code: 'NOT_HOST', message: 'Only the host can moderate' });
      return;
    }
    const { action, targetUserId } = payload ?? {};
    const target = this.participants.get(targetUserId);
    if (!target && action !== 'lock' && action !== 'unlock') return;
    switch (action) {
      case 'mute':
        target.muted = true;
        this.mutedUntilDisconnect.add(targetUserId);
        break;
      case 'unmute':
        target.muted = false;
        this.mutedUntilDisconnect.delete(targetUserId);
        break;
      case 'remove':
        if (targetUserId === this.hostUserId) return;
        if (target.socket) target.socket.leave(this.room);
        this.participants.delete(targetUserId);
        this.emit('room.moderation.removed', { targetUserId });
        break;
      case 'lock':
        this.doc.settings.isLocked = true;
        break;
      case 'unlock':
        this.doc.settings.isLocked = false;
        break;
      case 'transferHost':
        if (!target || action === 'transferHost' && targetUserId === this.hostUserId) return;
        this.transferHostTo(targetUserId);
        break;
      default:
        return;
    }
    WatchSpace.updateOne({ _id: this.id }, { settings: this.doc.settings }).catch(() => {});
    this.emit('room.moderation.update', { action, targetUserId });
    this.systemMessage(`${socket.data.user.displayName}: ${action}`);
  }

  transferHostTo(newHostId) {
    this.hostUserId = newHostId;
    this.clock.set({ state: 'paused' });
    this.emit('room.host.promoted', { hostUserId: newHostId });
    this.emit('room.playback.update', { ...this.clock.snapshot(), issuedBy: 'system' });
    WatchSpace.updateOne({ _id: this.id }, { hostUserId: newHostId }).catch(() => {});
    this.log('host transferred', { newHostId });
  }

  onEndRequest(socket) {
    if (!this.isHost(socket)) {
      this.emitTo(socket, 'room.error', { code: 'NOT_HOST', message: 'Only the host can end the session' });
      return;
    }
    this.end();
  }

  handleDisconnect(socket) {
    const userId = socket.data.user.id;
    const p = this.participants.get(userId);
    if (!p || p.socket !== socket) return;
    p.socket = null;
    p.disconnectedAt = Date.now();
    this.closeInterval(userId);
    this.emit('room.presence.update', { participantId: userId, displayName: p.displayName, action: 'left', participantCount: this.participantCount() });
    this.log('disconnect', { userId });
    if (userId === this.hostUserId) {
      this.status = 'host_disconnected';
      this.clock.set({ state: 'paused' });
      this.emit('room.host.disconnected', { promoteAfterMs: HOST_RECONNECT_GRACE_MS });
      this.emit('room.playback.update', { ...this.clock.snapshot(), issuedBy: 'system' });
      this.hostDownTimer = setTimeout(() => this.promoteNextHost(), HOST_RECONNECT_GRACE_MS);
    }
  }

  restoreHost() {
    clearTimeout(this.hostDownTimer);
    this.hostDownTimer = null;
    this.status = 'live';
    this.emit('room.host.restored', { hostUserId: this.hostUserId });
    this.log('host restored');
  }

  promoteNextHost() {
    const candidates = [...this.participants.entries()]
      .filter(([id, p]) => id !== this.hostUserId && p.socket && !p.socket.disconnected)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (!candidates.length) return;
    this.restoreHost();
    this.transferHostTo(candidates[0][0]);
  }

  startTriviaTicker(fromTs) {
    this.stopTriviaTicker();
    this.lastTriviaTs = fromTs;
    // Runs regardless of triviaEnabled: also flushes scheduled variation applies.
    this.triviaTimer = setInterval(() => this.tickPlayback(), TRIVIA_TICK_MS);
  }

  stopTriviaTicker() {
    clearInterval(this.triviaTimer);
    this.triviaTimer = null;
  }

  tickPlayback() {
    const pos = this.clock.positionAt();
    if (this.doc.settings.triviaEnabled) this.surfacedTrivia(pos);
    this.flushPendingApplies(pos);
    this.lastTriviaTs = pos;
  }

  surfacedTrivia(pos) {
    this.crossedMarkers(this.lastTriviaTs, pos, ['trivia', 'glossary', 'character', 'scene'])
      .forEach((evt) => {
        this.stats.triviaSurfaced += 1;
        this.emit('room.ai.trivia', { eventId: `${this.id}:${evt.ts}:${evt.type}`, text: evt.text, tsSeconds: evt.ts, type: evt.type });
      });
  }

  crossedMarkers(fromTs, toTs, types) {
    return this.title.timeline
      .filter((e) => types.includes(e.type) && e.ts > fromTs && e.ts <= toTs)
      .sort((a, b) => a.ts - b.ts);
  }

  systemMessage(body) {
    const message = {
      _id: `sys-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      watchSpaceId: this.id,
      userId: null,
      msgType: 'system',
      body: sanitizeText(body),
      tsSeconds: Math.round(this.clock.positionAt() * 10) / 10,
      createdAt: new Date(),
    };
    this.emit('room.chat.message', message);
    ChatMessage.create(message).catch(() => {});
  }

  async end() {
    this.stopTriviaTicker();
    clearTimeout(this.voteTimer);
    this.activeVote = null;
    this.flushChat();
    this.clock.set({ state: 'paused' });
    this.closeSpan();
    for (const [userId] of this.participants) this.closeInterval(userId);
    await this.flushInteractions();
    this.status = 'ended';
    const summary = this.buildSummary();
    this.emit('room.ended', { summary });
    this.log('room ended');
    await WatchSpace.updateOne(
      { _id: this.id },
      { status: 'ended', endedAt: new Date(), summary }
    ).catch(() => {});
    this.registry.forget(this.id);
  }

  buildSummary() {
    const durationSeconds = this.doc.startedAt ? Math.round((Date.now() - this.doc.startedAt.getTime()) / 1000) : 0;
    return {
      durationSeconds,
      watchedSeconds: Math.round(this.playbackSpans.reduce((s, sp) => s + (sp.end - sp.start), 0) / 1000),
      peakParticipants: this.stats.peakParticipants,
      aiQuestionsAsked: this.stats.aiQuestionsAsked,
      triviaSurfaced: this.stats.triviaSurfaced,
      chatVolume: this.stats.chatVolume,
      votesCast: this.votesCast,
      variationsApplied: this.variationsApplied,
      participants: [...this.participants.entries()].map(([userId, p]) => ({
        userId,
        displayName: p.displayName,
        watchedSeconds: Math.min(this.watchedSecondsFor(userId), this.title.durationSeconds),
      })),
    };
  }

  close() {
    this.stopTriviaTicker();
    clearTimeout(this.hostDownTimer);
    clearTimeout(this.voteTimer);
    this.flushChat();
  }
}
