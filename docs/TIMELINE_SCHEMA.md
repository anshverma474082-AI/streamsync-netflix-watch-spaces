# StreamSync — Timeline Ingest Schema (`streamsync-timeline/v1`)

Timelines are the **pre-authored, pre-approved** metadata that the AI Content Engine
is allowed to speak from. Nothing is generated at request time. Admins upload via:

```
POST /api/v1/titles/:titleId/timeline?mode=merge|replace
Authorization: Bearer <admin token>
{ "timeline": [ <event>, … ] }
```

- `merge` appends to the existing timeline; `replace` swaps it entirely.
- Invalid payloads return **422** with one entry per violating path:
  `{ "error": "…", "details": [{ "path": "timeline[3].options[0].id", "message": "duplicate option id" }] }`
- The live contract is also served at `GET /api/v1/titles/:titleId/timeline/schema`.

## Event shape

All events:

| Field | Type | Rule |
|-------|------|------|
| `ts` | number | required, `0 ≤ ts ≤ title.durationSeconds` |
| `type` | string | required, one of `scene`, `character`, `trivia`, `glossary`, `variationPoint` |
| `text` | string | required (except `glossary`, where `term`+`definition` carry it); trimmed, ≤ 2000 chars, sanitized |
| `weight` | number | optional 0–5 (default 1) — retrieval ranking multiplier |
| `fromTs`/`toTs` | number | optional active span with `fromTs ≤ toTs` (entry "owns" that window) |
| `subtitleLocale` | string | optional, ≤ 10 chars — for locale packs auto-applied to matching viewers |

Per type:

- **`character`** — requires `characterName` (≤ 120). Optional `characterId`.
- **`glossary`** — requires `term` and `definition`.
- **`scene` / `trivia`** — just the common fields.
- **`variationPoint`** — requires unique `variationId` and `options`: 1–6 entries,
  each `{ id (unique within the point), label (string), text? }`. These are the only
  variants the group vote may ever apply.

## Example

```json
{
  "timeline": [
    { "ts": 56, "type": "character", "characterId": "c_bunny", "characterName": "Big Buck Bunny",
      "text": "The large good-natured rabbit wakes up in his burrow." },
    { "ts": 91, "type": "glossary", "term": "Blender",
      "definition": "The free open-source 3D creation suite used to make this film." },
    { "ts": 178, "type": "trivia", "weight": 1.2,
      "text": "The bullies were animated with exaggerated proportions." },
    { "ts": 405, "type": "variationPoint", "variationId": "v_02", "subtitleLocale": "hi",
      "text": "Hindi subtitle pack for the confrontation scene.",
      "options": [
        { "id": "a", "label": "Literal translation", "text": "अब बदले का समय है।" },
        { "id": "b", "label": "Idiomatic translation", "text": "अब हिसाब बराबर का!" }
      ] }
  ]
}
```

How this content is used:
- `scene/character/glossary/trivia` feed grounded Co-Pilot answers (windowed to the
  playhead) and the timed trivia ticker.
- `variationPoint` events drive group voting; with `subtitleLocale` set they instead
  auto-apply for viewers with that preference.
- The seeded demo catalog (`server/src/seed/data.js`) contains 44 authored events
  across the three Blender open movies.
