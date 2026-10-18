# StreamSync — Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ WATCH_SPACES : "hosts"
    USERS ||--o{ CHAT_MESSAGES : "writes"
    USERS ||--o{ INTERACTIONS : "builds history"
    TITLES ||--o{ WATCH_SPACES : "is watched in"
    TITLES ||--o{ INTERACTIONS : "is watched"
    WATCH_SPACES ||--o{ CHAT_MESSAGES : "contains"
    WATCH_SPACES ||--o{ INTERACTIONS : "attributes session"

    USERS {
        ObjectId _id PK
        string email UK
        string displayName
        string passwordHash "bcrypt cost 12"
        string role "viewer | host | admin"
        object preferences "{subtitleLocale, genreAffinity[]}"
    }
    TITLES {
        ObjectId _id PK
        string name
        string description
        int durationSeconds
        string[] genres
        string videoAssetUrl "/media/*.mp4 (CC clips)"
        string posterUrl
        int year
        array timeline "embedded events — read as a whole"
    }
    WATCH_SPACES {
        ObjectId _id PK
        ObjectId titleId FK
        ObjectId hostUserId FK
        string inviteCode UK "NX-XXXXXXXX"
        string roomName
        string status "scheduled | live | ended"
        array participants "[{userId FK, joinedAt, leftAt}]"
        object settings "{maxParticipants, aiVerbosity, votingEnabled, triviaEnabled, isLocked}"
        date startedAt
        date endedAt
        object summary "written once at end: durationSeconds, watchedSeconds, peakParticipants, aiQuestionsAsked, triviaSurfaced, chatVolume, votesCast, variationsApplied, participants[]"
    }
    CHAT_MESSAGES {
        ObjectId _id PK
        ObjectId watchSpaceId FK
        ObjectId userId FK "null = system/AI"
        string msgType "chat | ai_answer | system"
        string body "sanitized, <=2000 chars"
        float tsSeconds "playback position"
        array reactions
    }
    INTERACTIONS {
        ObjectId _id PK
        ObjectId userId FK
        ObjectId titleId FK
        ObjectId watchSpaceId FK "last session"
        int watchedSeconds "lifetime, accumulated per session"
        bool completed
        float rating "0-5"
        ObjectId[] coWatchedWith "overlap > 1s"
        date lastWatchedAt
    }
```

Notes
- Refresh tokens are **not** stored: stateless JWTs with a `type` claim (access 15 min, refresh 7 d, rotated on use).
- `timeline` is embedded in `titles` because it is always read as a whole per title (PRD §9.2) and versioned with it.
- The only per-session write burst is at room end: one chat `insertMany` batch cadence + one upsert per (user, title) interaction. Playback heartbeats never touch the DB.
- Recommended indexes: `chat_messages(watchSpaceId, createdAt)`, `interactions(userId, titleId)` unique, `watch_spaces(status)`, `users(email)` unique, `watch_spaces(inviteCode)` unique.
