import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from '../api.js';

export function useRoom(watchSpaceId, inviteCode) {
  const [meta, setMeta] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState({});
  const [trivia, setTrivia] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [vote, setVote] = useState(null);
  const [appliedVariations, setAppliedVariations] = useState({});
  const [error, setError] = useState(null);
  const [initialClock, setInitialClock] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const handlersRef = useRef({});

  useEffect(() => {
    const socket = io('/', { auth: { token: getAccessToken() } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('room.join', { watchSpaceId, inviteCode });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (e) => setError(e.message));

    socket.on('room.event', (env) => {
      const { event, payload } = env;
      const custom = handlersRef.current[event];
      custom?.(payload);
      switch (event) {
        case 'room.snapshot':
          setMeta(payload.room);
          setParticipants(payload.participants);
          setInitialClock(payload.clock);
          setAppliedVariations(Object.fromEntries((payload.room.appliedVariations ?? []).map((v) => [v.variationId, v])));
          break;
        case 'room.presence.update':
          setParticipants((prev) => applyPresence(prev, payload));
          break;
        case 'room.chat.history':
          setMessages((prev) => mergeById(payload.messages, prev));
          break;
        case 'room.chat.message':
          setMessages((prev) => mergeById(prev, [payload]));
          break;
        case 'room.chat.typing':
          setTyping((t) => ({ ...t, [payload.userId]: payload.typing }));
          break;
        case 'room.chat.reaction':
          setMessages((prev) => prev.map((m) => (m._id === payload.messageId ? { ...m, reactions: [...(m.reactions ?? []), { emoji: payload.emoji, userId: payload.userId }] } : m)));
          break;
        case 'room.ai.trivia':
          setTrivia(payload);
          break;
        case 'room.ai.answer':
          setAnswers((a) => [...a, payload]);
          break;
        case 'room.variation.voteOpen':
          setVote({ ...payload, phase: 'open', endsAt: Date.now() + (payload.durationMs ?? 15000) });
          break;
        case 'room.variation.voteClosed':
          setVote((v) =>
            v && v.variationId === payload.variationId
              ? { ...v, phase: 'closed', tally: payload.tally, totalVotes: payload.totalVotes, winnerOptionId: payload.winnerOptionId }
              : v
          );
          break;
        case 'room.variation.applied':
          setAppliedVariations((m) => ({ ...m, [payload.variationId]: payload }));
          setVote((v) => (v && v.variationId === payload.variationId ? { ...v, phase: 'applied', applied: payload } : v));
          break;
        case 'room.host.disconnected':
          setMeta((m) => (m ? { ...m, status: 'host_disconnected' } : m));
          break;
        case 'room.host.restored':
        case 'room.host.promoted':
          setMeta((m) => (m ? { ...m, status: 'live', hostUserId: payload.hostUserId ?? m.hostUserId } : m));
          break;
        case 'room.ended':
          setMeta((m) => (m ? { ...m, status: 'ended', summary: payload.summary } : m));
          break;
        case 'room.error':
          setError(payload.message);
          break;
        default:
          break;
      }
    });

    return () => socket.close();
  }, [watchSpaceId, inviteCode]);

  const emit = (event, payload) => socketRef.current?.emit(event, payload);
  const on = (event, fn) => {
    handlersRef.current[event] = fn;
  };
  const clearVote = () => setVote(null);

  return {
    socketRef, emit, on, meta, participants, messages, typing, trivia, answers, vote, appliedVariations, clearVote, error, connected, initialClock,
    setError, setTrivia,
  };
}

function applyPresence(prev, { participantId, displayName, action, online }) {
  const idx = prev.findIndex((p) => p.userId === participantId);
  const entry = { userId: participantId, displayName, online: action !== 'left', muted: false };
  if (idx === -1) return [...prev, entry];
  const copy = [...prev];
  copy[idx] = { ...copy[idx], ...entry };
  return copy;
}

function mergeById(a, b) {
  const seen = new Set();
  return [...a, ...b].filter((m) => (seen.has(m._id) ? false : seen.add(m._id)));
}
