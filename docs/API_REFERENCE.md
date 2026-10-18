# StreamSync — REST API Reference

Base URL: `http://localhost:4000/api/v1` · All bodies JSON · Auth: `Authorization: Bearer <accessToken>`
Rate limit: 300 req/min/IP. Errors: `{ "error": "message", "details": [...] }` with the proper HTTP status.

## Auth — `/auth`

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/auth/register` | — | `{email, displayName, password (≥8), role? 'viewer'\|'host'}` | 201 `{user, accessToken, refreshToken}`; `role:'admin'` → 403 |
| POST | `/auth/login` | — | `{email, password}` | 200 `{user, accessToken, refreshToken}` · 401 bad credentials |
| POST | `/auth/refresh` | — | `{refreshToken}` | 200 `{accessToken, refreshToken}` (rotated) · 401 |
| GET | `/auth/me` | Bearer | — | 200 `{user}` |
| PATCH | `/auth/me/preferences` | Bearer | flat `{subtitleLocale?, genreAffinity?[]}` | 200 `{user}` |

`user` = `{id, email, displayName, role, preferences:{subtitleLocale, genreAffinity[]}}`.

## Titles — `/titles` (all Bearer)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/titles` | Catalog: `{titles:[{_id,name,description,durationSeconds,genres,posterUrl,videoAssetUrl,year}]}` |
| GET | `/titles/:titleId` | One title incl. timeline length |
| GET | `/titles/:titleId/timeline?from=&to=` | Timeline events (optionally windowed by seconds) |
| GET | `/titles/:titleId/timeline/schema` | Machine-readable ingest contract (`streamsync-timeline/v1`) |
| POST | `/titles/:titleId/timeline?mode=merge\|replace` | **Admin only.** Body `{timeline:[events]}`. 200 `{titleId,ingested,totalEvents,mode}` · 422 `{error, details:[{path,message}]}` per invalid path · 403 non-admin. Content must be pre-authored & pre-approved — nothing is generated server-side. |

## Watch Spaces — `/watch-spaces` (all Bearer)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/watch-spaces` | **Host/admin.** `{titleId, roomName?, maxParticipants? 2-50, aiVerbosity? 'minimal'\|'normal'\|'chatty', votingEnabled?}` → 201 `{watchSpaceId, inviteCode, status, hostUserId}` |
| GET | `/watch-spaces` | Live + scheduled rooms: `{rooms:[{watchSpaceId, roomName, status, title, participantCount}]}` |
| GET | `/watch-spaces/:id` | Room detail incl. clock snapshot + applied variations |
| GET | `/watch-spaces/invite/:code` | Resolve invite code (used by join-by-code UI) |
| POST | `/watch-spaces/:id/ai/ask` | REST twin of the socket question: `{question, positionSeconds?}` → grounded answer `{grounded, answer, sourceEvents[], matchedTs, latencyMs}` |
| POST | `/watch-spaces/:id/end` | **Host/admin.** Ends session, flushes interactions → `{watchSpaceId, status:'ended', summary}` |

## Recommendations — `/recommendations` (all Bearer)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/recommendations/me?limit=1..20` | `{generatedAt, model:{trainedAt,interactionCount,viewerCount}, recommendations:[{titleId,name,posterUrl,genres,durationSeconds,score,contentScore,collabScore,reasons[]}]}` — already-watched titles excluded |
| POST | `/recommendations/me/ratings` | `{titleId, rating 0-5}` → 200 `{interaction}`; upserts and force-retrains the model |
| GET | `/recommendations/me/interactions` | Watch history: `{interactions:[{id,title,watchedSeconds,completed,rating,coWatchedWith,lastWatchedAt}]}` |
| POST | `/recommendations/retrain` | **Admin only.** `{trainedAt, interactionCount, viewerCount, evaluation:{k,evaluated,hits,precision}}` (leave-one-out precision@5) |
| GET | `/recommendations/analytics/sessions` | **Admin only.** Ended sessions with `{summary, persisted:{chatVolume,participantsRecorded}, reconciled:{chatVolume,participants}}` — in-memory broadcast vs Mongo truth |

### Example session summary (`room.ended` payload and `POST /:id/end`)

```json
{
  "durationSeconds": 640, "watchedSeconds": 590, "peakParticipants": 3,
  "aiQuestionsAsked": 4, "triviaSurfaced": 7, "chatVolume": 25,
  "votesCast": 3, "variationsApplied": 2,
  "participants": [{ "userId": "…", "displayName": "Ana", "watchedSeconds": 585 }]
}
```
