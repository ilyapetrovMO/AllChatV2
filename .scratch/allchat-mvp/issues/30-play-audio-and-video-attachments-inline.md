# 30 — Play audio and video Attachments inline

**What to build:** Render supported audio and video Attachments as native players in text conversations for both existing history and newly arriving realtime Messages.

**Status:** resolved

- [x] `video/*` Attachments render as responsive native video players with controls.
- [x] `audio/*` Attachments render as native audio players with controls.
- [x] Players use metadata preloading and retain a download fallback.
- [x] Media Attachment responses preserve their declared MIME type, support range serving, and use an inline disposition.
- [x] Generic files remain forced downloads with `application/octet-stream` and `nosniff`.
- [x] Direct-load and SPA-opened realtime Messages use the same media renderer.
- [x] Browser coverage verifies realtime delivery and persistence after reload.

## Answer

Added matching server and browser media rendering for image, video, audio, and generic Attachment classes. Safe media responses are served inline through the authorized Attachment endpoint, while arbitrary files retain forced-download handling. Direct channel loads now also expand batched realtime events without depending on deferred application-script ordering.
