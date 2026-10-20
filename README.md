# StreamSync — AI-Driven Hyper-Personalized Interactive Content & Social Watch Spaces

**Netflix Full-Stack Development Internship · Track A (Full-Stack) · Stack Option B: MERN**
**MongoDB + Express + React (Vite) + Socket.io — plain JavaScript (no TypeScript).**

StreamSync lets a group of friends watch a title together in a **Watch Space** with a
server-authoritative synchronized playhead, live chat, an **AI Content Co-Pilot** that
answers questions strictly from each title's pre-authored metadata, group-voted
**content variations** and localized subtitle packs, and a **hybrid recommendation
engine** trained on real co-watching behaviour.

The demo videos are open-licensed Blender open movies (CC-BY) served locally — no
third-party keys or logins are needed to run or review the project.

---

## The three epics (all implemented)

### Epic 1 — Real-time Watch Spaces (sync + social)
- Authoritative in-memory `RoomClock` per space; mirrors derive their playhead from
  the clock (not `timeupdate`), with NTP-style median-of-8 clock-skew estimation and
  tiered drift correction (dead-band → soft seek → hard seek). The host never self-corrects.
- Playback state machine (idle/playing/paused/seeking), host-controlled, with
  `sync.ping/pong` offset measurement.
- Chat with batching (25 msgs / 5 s windows), typing indicators, emoji reactions,
  moderation (mute/remove), host disconnect grace + promotion, reconnect with
  in-place resume, one-socket-per-user enforcement, invite codes, locked rooms.

### Epic 2 — AI Content Engine (search-based, fully grounded, no LLM)
- `server/src/ai/retrieval.js`: cosine-style token retrieval over each title's
  **pre-authored timeline**, windowed to the current playhead (90 s lookbehind /
  15 s lookahead). Every answer cites the exact timeline entries it used
  (`sourceEvents[]`); questions outside the ingested metadata are **refused** — the
  co-pilot never fabricates. Answer latency p95 ≤ 1 ms (measured, see
  [docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- Timed trivia scheduler during playback; **group variation voting**: host opens a
  vote over a small pre-approved option set, 15 s window, live tally, winner applied
  simultaneously to every viewer at the authored timestamp.
- **Locale subtitle packs**: viewers whose `subtitleLocale` matches a pack receive it
  automatically — no vote needed.
- **Admin timeline ingest**: `POST /api/v1/titles/:id/timeline` validates against a
  documented schema (`GET …/timeline/schema`), returning per-path errors on bad
  payloads; content is always pre-authored and pre-approved, never generated live.

### Epic 3 — Personalization dashboard & recommender
- `server/src/ai/recommender.js`: hybrid model in plain JS — content-based genre
  cosine + item-item collaborative similarity with popularity damping, both
  max-normalised and blended 0.45/0.55. Each card explains **why** it was picked.
- Cold start handled: collaborative signal survives thin profiles and vice versa.
- Interaction tracking with **no per-heartbeat writes**: watched seconds are computed
  by intersecting presence intervals with authoritative playback spans and flushed
  once per (user, title) at session end.
- Dashboard: personalized rails, star ratings, watch history, subtitle-locale +
  genre-affinity preferences, live-room quick rejoin; admin panel with one-click
  **retrain + leave-one-out precision@5 report**, timeline upload UI, and
  **session analytics reconciled** against persisted rows.

## Quickstart

Prereqs: Node ≥ 20, npm, MongoDB running locally (`brew services start mongodb-community`).

```bash
git clone <this repo> && cd streamsync
cp server/.env.example server/.env        # then set your own JWT secrets
./scripts/fetch-media.sh                  # downloads CC-licensed demo clips (~200 MB, git-ignored)

cd server  && npm install && npm run seed && npm start        # API + gateway on :4000
cd ../client && npm install && npm run dev                    # React app on :5173
```

Open http://localhost:5173. Sign in with a seeded demo account:

| Account | Email | Password | Role |
|---------|-------|----------|------|
| Host | `host@streamsync.dev` | `streamsync-host-1` | host |
| Ana | `ana@streamsync.dev` | `streamsync-fan-1` | viewer |
| Ravi | `ravi@streamsync.dev` | `streamsync-fan-1` | viewer (Hindi locale — auto subtitle packs) |
| Mei | `mei@streamsync.dev` | `streamsync-fan-1` | viewer |
| Admin | `admin@streamsync.dev` | `streamsync-admin-1` | admin (dashboard panel) |

**5-minute demo script:** sign in as Host → open a Watch Space on *Big Buck Bunny* →
copy the invite code → sign in as Ravi in a second browser → join → press play, seek,
pause (mirrors follow within milliseconds). Ask the Co-Pilot *"who is Frank?"* near
3:00 (grounded card with citations) and *"who is the dragon Zaroth?"* (refusal —
it only speaks from authored metadata). Trigger the vote near 6:45 and watch both
clients switch endings simultaneously; Ravi's Hindi subtitle pack applies without a
vote. End the session → summary card → open the Dashboard: different recommendation
rails per user, star a title, and (as Admin) retrain the model and upload a timeline.

## Tests & measured performance

```bash
cd server
npm test                        # 38 Jest unit + integration tests
node scripts/ws-test-client.js  # 14-check end-to-end harness over REST + 2 live sockets
node scripts/perf-bench.js localhost:4000 25   # measured latency percentiles
```

Headline measured numbers (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)):
playback fan-out p95 **1 ms** at 25 viewers · AI answer p95 **1 ms** · API p95
**≤ 2.3 ms** · browser-measured mirror drift **117 ms** median.

## Documentation map

| Doc | Contents |
|-----|----------|
| [docs/DESIGN_SPEC.md](docs/DESIGN_SPEC.md) | Approved design: architecture, sync protocol, AI approach |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module breakdown, data flow, key decisions |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every REST endpoint with examples |
| [docs/WS_EVENTS.md](docs/WS_EVENTS.md) | Socket.io event catalogue + envelope format |
| [docs/ER_DIAGRAM.md](docs/ER_DIAGRAM.md) | Entity-relationship diagram (Mermaid) |
| [docs/TIMELINE_SCHEMA.md](docs/TIMELINE_SCHEMA.md) | Pre-authored timeline format |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Measured latency/drift numbers |
| [docs/evidence/TEST_REPORT.md](docs/evidence/TEST_REPORT.md) | Real test/harness output + screenshot evidence |
| [docs/RETROSPECTIVE.md](docs/RETROSPECTIVE.md) | Deliberate scope decisions, results vs KPIs, limitations |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 24/7 cloud deploy: Render free + MongoDB Atlas blueprint |
| [postman/StreamSync.postman_collection.json](postman/StreamSync.postman_collection.json) | Importable API collection |

## Security (PRD §10.1)

- All secrets (Mongo URI, JWT signing keys) come from **environment variables**;
  `.env` is git-ignored and `.env.example` documents required keys.
- Passwords hashed with bcrypt (cost 12); stateless JWT access (15 min) + refresh
  (7 d) with typed claims; refresh rotation on use.
- RBAC on routes (`viewer`/`host`/`admin`) **and** on every socket handler
  (e.g. only the host controls playback; only admins ingest timelines).
- Registration cannot self-assign admin. Rate limiting on `/api` (300 req/min/IP).
- All chat/timeline text sanitized before storage/render (XSS); no SQL/NoSQL
  injection vectors (Mongoose + strict schemas + object-id validation).

## Repository layout

```
streamsync/
├── client/            # React 18 + Vite SPA (Netflix-styled dark UI)
│   └── src/           #   pages, room components, sync controller, api client
├── server/            # Express API + Socket.io gateway + AI engine
│   ├── src/ai/        #   retrieval.js (grounded Q&A), recommender.js (hybrid)
│   ├── src/realtime/  #   Room.js, clock.js, gateway.js, rooms.js
│   ├── src/models/    #   Mongoose schemas (6 collections)
│   ├── src/routes/    #   auth, titles, watchSpaces, recommendations
│   ├── scripts/       #   ws-test-client.js, perf-bench.js
│   └── test/          #   Jest suites (5 files, 38 tests)
├── docs/              # spec, architecture, API, WS events, ER, schema, perf
├── scripts/           # fetch-media.sh
└── postman/           # API collection
```
