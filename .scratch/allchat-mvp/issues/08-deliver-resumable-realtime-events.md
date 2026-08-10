# 08 — Deliver resumable realtime events

**What to build:** Authenticated clients receive authorized Message changes through one versioned WebSocket stream and recover deterministically after disconnection without leaking activity from hidden spaces.

**Blocked by:** 07 — Exchange persistent Text Channel Messages

**Status:** resolved

- [x] An authenticated WebSocket delivers sequenced creation, edit, and deletion events after the originating transaction commits.
- [x] Every delivered event is filtered using the receiving Member's current authorization.
- [x] A reconnecting client resumes from its last retained cursor without duplicates or gaps in externally visible state.
- [x] An expired cursor produces an explicit snapshot-required response and an authorized snapshot with a new cursor.
- [x] Permission loss removes affected state/subscriptions without revealing subsequent activity.
- [x] Slow clients are bounded and disconnected or resynchronized rather than consuming unbounded memory.
- [x] Black-box concurrency and reconnect tests prove HTTP history and WebSocket state converge.
