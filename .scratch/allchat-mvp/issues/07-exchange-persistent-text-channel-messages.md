# 07 — Exchange persistent Text Channel Messages

**What to build:** Authorized Members can publish, read, edit, and delete durable Text Channel Messages and see a single consistent conversation order through the embedded web client and client-neutral API.

**Blocked by:** 06 — Organize visible Community channels

**Status:** resolved

- [x] Publishing a valid Message commits it durably before returning success.
- [x] Each Text Channel assigns a monotonically increasing Conversation Sequence under concurrent writers.
- [x] Authorized Members page retained history in stable sequence order after restart.
- [x] Authors can edit their Messages and readers see an edited marker.
- [x] Authors can delete their Messages; deleted bodies are not retained in a hidden application record.
- [x] Safe UTF-8 length ceilings and explicit limit errors apply consistently to API and web submissions.
- [x] Unauthorized, archived, suspended, or timed-out Members cannot perform disallowed Message actions.
