# StreamSync — Architecture

```
                        ┌──────────────────────────────────────────────┐
  Browser (React SPA)   │  Vite dev :5173  →  proxy /api /media /socket │
  ┌──────────────────┐  ───────────────┬──────────────────┬────────────┘
  │ pages/           │  REST /api/v1    │  Socket.io ws://5173
  │  Home, Room,     │ ────────────────▶│──────────────▶   │
  │  Dashboard, Auth │                  │                  │
  │ sync/            │           ┌──────▼──────────────────▼──────┐
  │  SyncController  │           │  Express app + Socket.io gateway│
  │ components/      │           │  (single Node process, :4000)   │
  │  Player, Chat,   │           │ ┌────────────┐ ┌──────────────┐ │
  │  Presence, Vote  │           │ │ REST routes│ │ RoomRegistry │ │
  └──────────────────┘           │ │ auth       │ │  Map<wsId,   │ │
                                 │ │ titles     │ │   Room>      │ │
                                 │ │ watchSpaces│ │ Room:        │ │
                                 │ │ recommend. │ │  RoomClock   │ │
                                 │ └─────┬──────┘ │  participants│ │
                                 │       │        │  AI hooks    │ │
                                 │       │        │  vote engine │ │
                                 │ ┌─────▼────────┴──────────────┐│
                                 │ │ AI engine (service modules) ││
                                 │ │ retrieval.js recommender.js ││
                                 │ └─────┬───────────────────────┘│
                                 └───────┼────────────────────────┘
                                   ┌─────▼──────┐   ┌───────────────┐
                                   │  MongoDB   │   │ /media static │
                                   │ 6 collections│  │ CC clips,     │
                                   └────────────┘   │ range-served  │
                                                    └───────────────┘
```

## Layers & module responsibilities

| Module | Responsibility |
|--------|----------------|
| `server/src/app.js` | Express wiring: CORS, rate limit, static media (range requests), routes, error handler |
| `server/src/realtime/gateway.js` | Socket.io server, JWT handshake auth (`auth.token`), registry mount |
| `server/src/realtime/rooms.js` | RoomRegistry: lazy room creation from persisted WatchSpace, join handshake, one-socket-per-user |
| `server/src/realtime/Room.js` | Per-space state: playback, chat batching, moderation, voting, trivia ticker, interaction intervals, summary |
| `server/src/realtime/clock.js` | `RoomClock` — the single source of truth for position; `positionAt(t)` extrapolates while playing |
| `server/src/ai/retrieval.js` | Grounded extractive Q&A over the authored timeline (windowed, cited, refuses out-of-scope) |
| `server/src/ai/recommender.js` | Hybrid content+collaborative model, precision@K evaluation |
| `server/src/utils/timelineSchema.js` | Validation of admin-ingested timelines (per-path errors) |
| `client/src/sync/syncController.js` | Client mirror of the clock: skew estimation, drift correction tiers, seek/hold |

## Key decisions

1. **Server-authoritative clock, client-derived playhead.** Mirrors never trust
   `timeupdate` for UI state; a 250 ms poll reads `SyncController.currentPosition()`,
   which for viewers is `clock.positionAt(now - skew)`. Skew is a median-of-8 sample
   RTT estimate (NTP-style). Corrections are tiered so small drift never causes a
   visible seek.
2. **AI without an LLM.** The PRD demands grounded, pre-authored content. Retrieval
   is a deterministic search over ingested timeline events with a proximity window
   around the playhead; answers are composed only from matched entries and always
   carry `sourceEvents[]` citations. Out-of-window or unknown-entity questions return
   an explicit refusal that names the current clock position.
3. **No heartbeat writes.** Watched-time is reconstructed at session end by
   intersecting each participant's presence interval list with the room's playback
   spans — bounded, auditable, and cheap (one upsert per user×title per session).
4. **In-process recommender.** The model is a plain object rebuilt by
   `POST /retrain` (admin) or implicitly on rating writes — no redeploy to refresh
   a rail, no external ML service, and precision@5 is measured leave-one-out at
   retrain time so quality is visible in the API response.
5. **Envelope protocol on Socket.io.** Every server→client message is
   `{event, watchSpaceId, payload, ts}` on the single `room.event` channel, so the
   client has one dispatch point, and `ts` (server clock) makes fan-out latency
   directly measurable (`perf-bench.js`).
6. **Rooms are recoverable.** Room state lives in memory for speed, but
   `RoomRegistry.getOrCreate` rebuilds from the persisted WatchSpace + Title, so a
   server restart resumes scheduled/live spaces; chat history hydrates on join;
   applied variations replay for rejoiners.

## Data flow — "host seeks to 5:00"

1. Host client emits `room.playback.update {state:'seeking', positionSeconds:300}`.
2. `Room.onPlayback` verifies host authority, updates `RoomClock`, broadcasts
   `room.playback.update` (with `issuedBy`) to the room.
3. Mirrors compute expected position, compare to local video, and apply tiered
   correction; UI position comes from the clock poll, so the slider moves instantly
   even while the media element buffers.
4. The seek itself opens a new playback span only when state returns to `playing` —
   this is what makes watched-seconds honest.
