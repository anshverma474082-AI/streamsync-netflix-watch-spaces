# StreamSync — Design Specification

**Track:** A (Full-Stack) · **Stack:** Option B — MERN (MongoDB + Express.js + React + Socket.io, plain JavaScript)

Approved design for the "AI-Driven Hyper-Personalized Interactive Content & Social Watch Spaces" PRD.

## Architecture

Five cooperating layers, single process pair (API+gateway server, React SPA client):

```
React SPA ──REST /api/v1──▶ Express API ─▶ Mongoose ─▶ MongoDB
    └─────Socket.io (rooms keyed by watchSpaceId)──▶ Realtime Gateway ─▶ AI Content Engine (shared service modules)
```

- Authoritative playback clock lives **in memory** per room; only coarse session summaries are persisted at room end (PRD §9.4).
- AI Content Engine is plain service modules (`retrieve`, `answer`, `triviaScheduler`, `variation`) called by both REST controllers and socket handlers — written once, shared.
- One shared Mongoose connection for Express and Socket.io.

## Data model (6 collections)

- **users** — email (unique), displayName, passwordHash, role ∈ {viewer, host, admin}, preferences {subtitleLocale, genreAffinity[]}
- **titles** — name, durationSeconds, genres[], videoAssetUrl, posterUrl, embedded `timeline[]` (read-as-a-whole per PRD §9.2): events keyed by `ts` with type ∈ {scene, character, trivia, glossary, variationPoint}; variationPoint carries `options[{id,label,text,assetRef}]`
- **watch_spaces** — titleId, hostUserId, inviteCode (unique), status ∈ {scheduled, live, ended}, participants[], settings {maxParticipants, aiVerbosity, votingEnabled}, session summary
- **chat_messages** — watchSpaceId, userId (null for AI/system), msgType ∈ {chat, ai_answer, system}, body, tsSeconds
- **interactions** — userId, titleId, watchedSeconds, completed, rating, coWatchedWith[] — feeds the recommender
- Refresh tokens: stateless JWTs with a `type` claim; access 15 min, refresh 7 days.

## Real-time sync (Epic 1)

- Room state machine: playing / paused / seeking / buffering, host-authoritative.
- `room.playback.update` events carry server-issued wall-clock timestamps; clients compute clock skew via `room.sync.ping/pong` RTT.
- Drift correction tiers: <400 ms → playbackRate nudge (0.95–1.05, silent); ≥400 ms → micro-seek. Join-mid-playback syncs within 250 ms in <2 s.
- Chat: typing indicators, emoji reactions, server-side batched writes (2 s / 20 messages), history for reconnecting clients.
- Presence + connection quality; reconnect resume token (no duplicate joins, chat context intact).
- Host disconnect → deterministic "host disconnected" state; earliest participant auto-promoted after 15 s, playback paused meanwhile.
- Moderation: mute, remove, lock room, transfer host — all re-validated server-side per event (only current host token may issue `room.playback.update`).

## AI Content Engine (Epic 2)

- Retrieval: tokenizes question, scores timeline events in the current + preceding window (keyword/field match on character names, glossary, scene/trivia text). No LLM key required — extractive, fully grounded.
- Answers composed only from retrieved authored text; payload includes `sourceEvents[]`. Below confidence threshold → graceful refusal. Never fabricates (PRD acceptance criterion).
- Trivia scheduler: server pushes `room.ai.trivia` within 1 s of crossed markers; host-toggleable, verbosity-aware.
- Subtitle/localization variations: versioned authored tracks; locale-preference swap without desync.
- Narrative-variation voting: host opens timed vote (`room.variation.voteOpen`), server tallies, applies winner to all clients simultaneously at the authored `ts` (`room.variation.applied`).

## Dashboard & recommendations (Epic 3)

- Hybrid recommender (pure JS): content-based cosine over genre/affinity + item-item collaborative over co-rating/co-watch; blended score; offline retrain endpoint — no redeploy needed for rail updates. Precision@5 evaluated against held-out interactions in tests.
- Session analytics reconciled against the persisted event log.
- Admin timeline upload validates JSON against a documented schema; non-admin → 403 server-side.

## Security (PRD §10.1)

JWT at REST and WebSocket handshake; RBAC middleware + per-event role checks; server-side validation (express-validator) and sanitization (escape-html) of chat, questions, uploads; bcrypt passwords; secrets only via `.env`.

## Performance targets & evidence (PRD §10.2)

Measured locally by a scripted multi-client WebSocket harness (6 clients): sync drift, API P95 (<200 ms), AI latency (<3 s), fan-out (<500 ms). Real numbers recorded in `docs/PERFORMANCE.md`.

## Videos

Public open-license test-bucket URLs (Big Buck Bunny, Sintel, Tears of Steel, Elephant's Dream) — clone-and-run with no assets to supply.

## Testing

Jest + Supertest: playback state machine, AI retrieval logic, RBAC enforcement, variation voting; socket.io-client integration tests for sync and reconnect.
