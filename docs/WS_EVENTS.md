# StreamSync — Socket.io Event Catalogue

Connection: `ws://localhost:4000` (Vite proxies `/socket.io` in dev).
Handshake auth: `io(url, { auth: { token: <accessToken> } })` — unauthenticated
sockets are rejected; one live socket per user (`ALREADY_IN_ROOM` otherwise).

Every server→client message travels on the single channel **`room.event`** as an
envelope:

```json
{ "event": "room.playback.update", "watchSpaceId": "…", "payload": { … }, "ts": 1730000000000 }
```

`ts` is the server emit time — used by clients/benchmarks to measure fan-out.

## Client → Server

| Event | Payload | Permission | Effect |
|-------|---------|-----------|--------|
| `room.join` | `{watchSpaceId, inviteCode?}` | any user | Join; locked rooms require `inviteCode`; returns `room.snapshot` + `room.chat.history`; rejoin resumes in place |
| `room.playback.update` | `{state:'playing'\|'paused'\|'seeking', positionSeconds?}` | **host only** | Moves the authoritative `RoomClock`; broadcast to room |
| `room.sync.ping` | `{clientSentAt}` | any | `room.sync.pong` with clock snapshot (skew/RTT estimation) |
| `room.chat.send` | `{body}` (≤2000 chars, sanitized) | non-muted | Broadcast + batched persistence |
| `room.chat.typing` | `{typing: bool}` | any | Typing indicator broadcast (auto-clear 1.5 s) |
| `room.chat.react` | `{messageId, emoji}` | any | Reaction broadcast |
| `room.moderation` | `{action:'mute'\|'unmute'\|'remove'\|'lock'\|'unlock'\|'promote', targetUserId}` | **host only** | Moderation |
| `room.ai.ask` | `{question, questionId?, positionSeconds?}` | any | Grounded answer broadcast to room |
| `room.variation.openVote` | `{variationId}` | **host only** | Opens 15 s vote over the pre-authored option set |
| `room.variation.vote` | `{variationId, optionId}` | any | Casts one vote (first counts) |
| `room.end` | — | **host only** | Ends session: flushes chat + interactions, broadcasts summary |

## Server → Client (`room.event` names)

| Event | Payload | Meaning |
|-------|---------|---------|
| `room.snapshot` | `{status, clock, participants, appliedVariations, settings, …}` | Full state on join |
| `room.playback.update` | `{state, positionSeconds, serverTs, rate, issuedBy}` | Clock moved |
| `room.sync.pong` | `{clientSentAt, serverReceivedAt, serverSentAt, clock}` | RTT/skew sample |
| `room.presence.update` | `{participantId, displayName, action:'joined'\|'left', participantCount}` | Presence |
| `room.chat.message` | `{_id, userId, displayName, body, tsSeconds, reactions}` (userId null = system/AI) | Chat |
| `room.chat.typing` | `{userId, displayName, typing}` | Typing |
| `room.chat.reaction` | `{messageId, userId, emoji}` | Reaction |
| `room.chat.history` | `{messages[]}` | Last 100 on join |
| `room.ai.answer` | `{questionId, question, grounded, answer, sourceEvents[], matchedTs, confidence, latencyMs, askedBy}` | Co-pilot reply (refusals have `grounded:false`, empty `sourceEvents`) |
| `room.ai.trivia` | `{eventId, text, tsSeconds, type}` | Timed trivia card during playback |
| `room.variation.voteOpen` | `{variationId, text, options:[{id,label}], closesAt}` | Vote UI opens |
| `room.variation.vote` (ack) | tally updates `{variationId, tally, totalVotes}` | Live counts |
| `room.variation.voteClosed` | `{variationId, tally, totalVotes, winnerOptionId}` | Window ended (authored-order tie-break) |
| `room.variation.applied` | `{variationId, optionId, text, tsSeconds}` | All clients switch at the authored ts simultaneously |
| `room.host.disconnected` / `room.host.restored` / `room.host.promoted` | `{promoteAfterMs}` / `{hostUserId}` | Host failover |
| `room.moderation.update` / `room.moderation.removed` | `{action,targetUserId}` / `{targetUserId}` | Moderation results |
| `room.ended` | `{summary}` (see API_REFERENCE) | Session closed + persisted |
| `room.error` | `{code, message}` | e.g. `NOT_HOST`, `ROOM_FULL`, `ROOM_LOCKED`, `WRONG_CODE`, `ALREADY_IN_ROOM`, `MUTED`, `NO_ACTIVE_VOTE` |

## Sync protocol (viewer side)

1. On join, store clock + `serverTs`; sample skew via `room.sync.ping` (median of 8 RTT/2 offsets).
2. Expected position = `clock.positionSeconds + (now - clock.serverTs - skew) * rate` while playing.
3. Every 250 ms the Player reads `SyncController.currentPosition()` (never `timeupdate`) for UI + slider.
4. If |video.currentTime − expected| exceeds the dead-band: soft correction (rate
   nudge) under 1.5 s, hard seek above it. The host is exempt (it *is* the source).
