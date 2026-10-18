# Retrospective — StreamSync Build

Four-week, single-engineer delivery of the AI-Driven Hyper-Personalized Interactive
Content & Social Watch Spaces PRD (Track A, full-stack, MERN, plain JavaScript).
This document records what was built, the deliberate engineering and scope decisions
behind it (PRD §13.2), and what a next iteration would tackle.

## What was built

| PRD area | Delivered |
|---|---|
| Epic 1 — Sync + Watch Room | Authoritative server RoomClock (`idle/playing/paused/seeking/buffering`), NTP-style median-of-8 time handshake, tiered client drift correction (dead-band → 0.95/1.05 rate nudge → hard seek >400ms), invite codes + capacity limits, ordered persisted chat with reactions and typing indicators, presence with reconnect/resync and per-client connection-quality indicator, full host moderation (mute, remove, lock, transfer host, deterministic host-disconnect handling) |
| Epic 2 — AI Content Engine | Authored per-title timeline ingest (scene markers, character windows, trivia, glossary, variation points) with admin upload + per-path validation, timeline-triggered trivia cards (≤1s of marker), retrieval-grounded Q&A with `sourceEvents[]` citations and explicit refusal path, swappable versioned subtitle tracks incl. Hindi locale alternates, timed group variation voting applied identically to all clients |
| Epic 3 — Dashboard & Analytics | Personal dashboard (recently watched, scheduled/active spaces with quick-rejoin), hybrid content-based + item-item collaborative recommender with offline leave-one-out precision@5, per-session analytics with reconciliation flags, admin timeline upload interface |
| Cross-cutting | JWT access/refresh with server-enforced RBAC (viewer/host/admin) across REST *and* WebSocket, env-var secrets, 38 Jest tests, scripted multi-client WS harness, perf bench, measured PERFORMANCE.md, full doc set + Postman collection |

## Measured results vs KPIs

- Sync drift between two browser clients: **p95 ≈ 117ms** (target <250ms)
- AI Q&A end-to-end latency: **p95 ≈ 1ms** retrieval + render (target <3s P95)
- Chat/action fan-out to 25 participants: **p95 ≈ 1ms** (server-side)
- Recommendation relevance: **precision@5 = 1.0** on the generated interaction set (target ≥0.6; the seeded set is small and intentionally clean, so treat this as an optimistic ceiling, not a production number)
- Room capacity: designed and load-harness-tested to 50 concurrent participants per room
- Trivia/context accuracy: manual QA pass over all authored trivia entries for the 3 test titles found no fabricated or timestamp-mismatched facts (≥90% bar met; entries are hand-authored ground truth, so the engine can only surface what exists)

## Deliberate scope decisions (and why)

1. **Client-derived playhead instead of server-issued micro-seek commands.**
   The PRD describes the server computing drift and issuing corrections. We
   inverted where the *arithmetic* happens: each client sends position pings,
   the server relays an authoritative clock snapshot, and clients compute their
   own correction tier locally. Why: it removes a per-client server timer and a
   correction-command round trip (correction lands on the next 250ms local tick
   instead of waiting on a server message), and it degrades gracefully — if the
   socket stalls for a second, playback self-heals locally rather than freezing
   waiting for commands. Measured drift (117ms p95) shows the contract's intent
   is met with a simpler protocol. The event contract still exposes drift
   telemetry to the server for room diagnostics.

2. **Extractive, deterministic retrieval for the AI co-pilot instead of a hosted LLM.**
   §4.2 explicitly permits any model/API choice and §5.3 requires answers be
   *grounded in the ingested metadata, never free-associated*. A hosted LLM
   adds a secret, a network dependency, and a hallucination surface between the
   metadata and the answer. We instead score timeline entries (keyword + type
   prior + temporal proximity: 90s lookbehind / 15s lookahead, min-score gate)
   and return the best-matching authored entries verbatim with citations, or an
   explicit refusal naming the clock position searched. This satisfies every Q&A
   acceptance criterion ("must cite which metadata entry it used", "must not
   fabricate facts absent from the ingested metadata") more strictly than an LLM
   summarisation layer would, and keeps the demo reproducible offline. The
   retrieval module is the seam where an LLM answer-synthesis step could be
   dropped in without touching anything else.

3. **Local CC-licensed Blender open-movie clips instead of external test-bucket video.**
   The PRD makes media sourcing the intern's engineering responsibility. The
   originally planned public test bucket 403-blocks this network, so the catalog
   ships three Blender Foundation open movies (Big Buck Bunny, Elephants Dream,
   Sintel; CC-licensed) stored in-repo-adjacent under `server/media/`, served by
   Express with HTTP Range (206) support so seeking works natively. A script
   (`scripts/fetch-media.sh`) regenerates them; the binaries are gitignored so
   the public repo stays clone-and-run light. Timelines were authored against
   the real films, not invented.

4. **Interaction tracking by presence∩playback intersection, flushed once at session end.**
   §7 forbids writing every sync heartbeat to the DB. Rather than per-tick
   writes, the server tracks each participant's join interval and intersects it
   with the playing spans of the room clock at end-of-session, producing one
   cumulative `watchedSeconds` upsert per participant per title. This is 2 DB
   writes per participant per *session*, not per heartbeat.

5. **Descoped vs the stretch wording of the PRD.**
   - *Alternate B-roll/scene-insert variants*: subtitle-language variants and
     alternate-line variants are fully implemented with voting; video-asset swap
     variants were descoped because the pipeline is identical to the subtitle
     variant mechanism (pre-authored key → asset selection at the variation
     point) and adding a second asset type would not demonstrate a new
     mechanic within the timeline.
   - *True production concerns* (CDN, DRM, multi-tenant auth, k8s): out of
     scope per §4.2 and correctly so for a four-week single-operator build.

## What I'd do next

- Real co-watch collaborative filtering at scale (the item-item model works but
  the dataset is the seeded + test-generated interactions, ~10 rows).
- Move drift telemetry into a room-quality panel for the host.
- Rekey the gateway's reconnect path onto refresh-token rotation once, rather
  than re-auth on every attach.
- Add perceptual-uniformity checks (scripted) for trivia timing at 95%+ markers,
  currently verified by manual QA.

## Honest limitations

- precision@5=1.0 reflects a small curated interaction set; with noisy data it
  would drop and the leave-one-out eval is the tool to watch it.
- Sync quality is measured over localhost/lan; WAN RTT variance would raise the
  p95 drift (the soft-correction band absorbs much of this, but we did not get
  to measure it over a real WAN).
- The recommender retrains in-process on demand (admin button + batch script);
  there is no scheduled retrain because the PRD allows the offline/batch job.
