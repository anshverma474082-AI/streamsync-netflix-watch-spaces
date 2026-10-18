# Test Report — StreamSync

Captured 2026-10-18 on the final build. All output below is real, pasted from
the actual runs (not transcribed from expectations).

## 1. Automated unit + API tests — `cd server && npm test`

Jest (ESM mode), 5 suites / 39 tests, against a separate `streamsync_test` MongoDB:

```
Test Suites: 5 passed, 5 total
Tests:       39 passed, 39 total
Time:        0.997 s
```

Coverage areas:
- `clock.test.js` — playback state machine incl. idle/playing/paused/seeking/buffering
  transitions, position freeze rules, invalid-position rejection
- `retrieval.test.js` — grounded Q&A: lookback/lookahead windows, min-score gate,
  citations, refusal path, no cross-title leakage
- `recommender.test.js` — hybrid scoring, exclusions, cold-start fallback, leave-one-out precision@5
- `timelineSchema.test.js` — per-path 422 validation of uploaded timelines
- `api.test.js` — auth, RBAC, room lifecycle, moderation guards

## 2. End-to-end multi-client WebSocket harness — `node scripts/ws-test-client.js`

Two scripted socket clients joining a real Watch Space like browsers would:

```
PASS  health endpoint
PASS  catalog lists Big Buck Bunny
PASS  watch space created
PASS  two participants present
PASS  mirrors receive playback updates — pos=162.50
PASS  AI answer grounded with citations — character@162
PASS  chat broadcast across clients
PASS  room ended with summary
PASS  summary tracks session watch seconds
PASS  interaction totals accumulate (not clobbered by short session) — ana BBB lifetime=611
PASS  recommender serves Ana a rail excluding watched titles
PASS  analytics reconciles ended session — chat=1/1 participants=2
PASS  analytics is admin-only
PASS  recommendations require auth

All checks passed.
```

## 3. Role-based access control — live HTTP probes

```
no token   -> GET /api/v1/recommendations                    401
viewer     -> GET /api/v1/recommendations/analytics/sessions 403
viewer     -> POST /api/v1/recommendations/retrain           403
host       -> POST /api/v1/titles/:id/timeline               403  (admin-only)
```

## 4. Performance (measured, see docs/PERFORMANCE.md for method)

- Two-browser sync drift p95: **117 ms** (KPI <250 ms)
- AI Q&A latency p95: **~1 ms** retrieval + render (KPI <3 s)
- Chat/action fan-out to 25 participants p95: **~1 ms**
- Recommendation precision@5 on generated interaction set: **1.0** (KPI ≥0.6)

## 5. Manual browser QA — screenshots in this folder

| File | Shows |
|---|---|
| `evidence-01-create-modal.png` | Room creation with max-participants, AI verbosity, variation-voting, trivia-cards, invite-only settings |
| `evidence-02-participant-room.png` | Second browser mirroring host playback — "synced · drift 0 ms", connection-quality badge, HOST marker |
| `evidence-03-host-room.png` | Host session driving the room with presence panel |
| `evidence-04-ai-grounded-answer.png` | Co-Pilot **grounded** answer to "who is Frank?" with CITED chip pointing at the 2:42 character entry, plus the honest **no-match refusal** for an unanswerable question at the same clock position |
| `evidence-05-dashboard.png` | Personalized rails w/ reason chips, active-space quick-rejoin, admin ingest, ended-session analytics with `exact` reconciliation |
| `evidence-06-session-summary.png` | End-of-session summary stats + per-participant minutes saved to history |

Additional manual checks performed during development:
- Reconnect/resync: killed a client mid-playback; on rejoin it re-handshook the
  clock and landed within the 250 ms tolerance in under 2 s.
- Host disconnect: closing the host tab moved the room to a clearly labelled
  "Host disconnected — playback paused" state for all participants (deterministic, tested).
- Trivia accuracy: all authored trivia entries for the 3 test titles manually
  QA-passed against the films (≥90% bar; entries are hand-authored ground truth).
- Subtitle locale swap (Hindi pack) and group variation vote: exercised in
  earlier browser sessions; both applied without playback interruption or desync.
