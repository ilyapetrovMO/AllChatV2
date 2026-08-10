# 11 — Upload and safely retrieve Attachments

**What to build:** Members can attach files to Messages while the Instance maintains transactional metadata/file consistency, enforces storage safety, and cleans up abandoned or deleted data predictably.

**Blocked by:** 08 — Deliver resumable realtime events

**Status:** resolved

- [x] Uploads enter a temporary quarantine and become visible only with a successfully committed Message.
- [x] Interrupted uploads and failed Message transactions leave no permanently referenced or indefinitely retained file.
- [x] Generated storage identities prevent path traversal while safe original names remain available for display.
- [x] Downloads require Message authorization and use non-executable content disposition and safe content handling.
- [x] Configurable per-file and total-storage limits remain within non-disableable hard ceilings and return explicit errors.
- [x] Deleting a Message or channel schedules newly unreferenced files for garbage collection after a recovery window.
- [x] Attachment publication, realtime delivery, restart, and garbage collection are covered through the Instance boundary.
