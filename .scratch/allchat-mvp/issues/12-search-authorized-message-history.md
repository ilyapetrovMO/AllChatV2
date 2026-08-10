# 12 — Search authorized Message history

**What to build:** A Member can search retained Text Channel Messages they are currently permitted to see, with relevant results linked back to conversation context and no inference of hidden content.

**Blocked by:** 07 — Exchange persistent Text Channel Messages

**Status:** resolved

- [x] SQLite-backed full-text search indexes committed Message creation, edits, and deletions consistently.
- [x] Results contain only content from Text Channels visible to the requesting Member at query time.
- [x] Search supports stable pagination and navigation to surrounding authorized conversation context.
- [x] Archived visible channels remain searchable; deleted and unauthorized channels do not appear.
- [x] Malformed, empty, and resource-intensive queries are bounded and return explicit behavior.
- [x] Authorization-change and concurrent-index-update tests prove hidden content cannot be inferred through results or counts.
