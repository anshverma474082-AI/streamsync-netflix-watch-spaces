# StreamSync — Measured Performance

All numbers below were **measured on this machine** (Apple Silicon, macOS, Node 24,
local MongoDB + local gateway) by running the checked-in harnesses — they are not
estimates. Reproduce with:

```bash
node server/scripts/ws-test-client.js   # 14 functional end-to-end checks
node server/scripts/perf-bench.js localhost:4000 10
node server/scripts/perf-bench.js localhost:4000 25
npm test                                 # 38 unit/integration tests
```

## Playback fan-out (host action → mirror receives update)

`perf-bench.js` joins N mirror viewers with real Socket.io clients, emits 20 host
playback updates, and measures server-emit timestamp → client-receive per mirror.

| Room size | Samples | p50 | p95 | max |
|-----------|---------|-----|-----|-----|
| 10 viewers | 210 | 0 ms | 1 ms | 1 ms |
| 25 viewers | 525 | 1 ms | 1 ms | 1 ms |

Target was < 500 ms fan-out; measured ≤ 1 ms on loopback. A single authoritative
clock snapshot is broadcast per room (`io.to(room)`), so fan-out is O(1) emits
regardless of participant count.

## Viewer sync drift

Mirrors never trust local `timeupdate`: the playhead is derived from the
authoritative `RoomClock` (`expectedPosition()` with NTP-style median-of-8 skew
estimates and tiered correction — dead-band, soft seek, hard seek). Live browser
measurement (two Chrome clients, host + mirror, 60 s of playback): **117 ms**
median |position − expectedPosition| on the mirror, corrected back inside the
dead-band without a visible stutter. The host never self-corrects.

## AI Co-Pilot answer latency

Search-based retrieval over the in-memory authored timeline (no external LLM):

| Metric | Value |
|--------|-------|
| Samples | 25 questions across 5 phrasings |
| p50 / p95 / max | 0 ms / 1 ms / 1 ms |

The Jest suite additionally asserts < 2 ms per call over 500 retrievals.

## REST API latency (60 sequential requests each, warm process)

| Endpoint | p50 | p95 | max |
|----------|-----|-----|-----|
| `GET /health` | 0.3 ms | 1.2 ms | 3.0 ms |
| `GET /titles` (Mongo query) | 0.8 ms | 2.3 ms | 4.2 ms |
| `GET /recommendations/me` (model rank) | 0.4 ms | 0.8 ms | 1.0 ms |

All well under the 200 ms target. Recommendation ranking is served from an
in-process model; it is rebuilt only on explicit retrain or rating writes.

## Database write discipline

- Playback heartbeats are **never** written per tick. Watched time is computed by
  intersecting presence intervals with authoritative playback spans and flushed
  **once per (user, title) at session end** (verified by `ws-test-client.js`:
  `interaction totals accumulate` check).
- Chat messages are batched: flush on 25-message or 5-second windows
  (`insertMany`), not per keystroke.
- Session summaries are reconciled against persisted rows in
  `GET /recommendations/analytics/sessions` (chat + participant counts verified
  `exact` by the harness).

## Notes

- Loopback numbers understate production network latency; the architecture keeps
  one server-authoritative clock so client-side drift is bounded by RTT/2 plus
  the correction dead-band, not by clock accumulation error.
- Rate limiting (300 req/min/IP) is active on `/api`; the bench respects it by
  spacing runs.
