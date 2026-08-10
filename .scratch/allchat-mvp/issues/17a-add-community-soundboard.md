# 17a — Add a Community soundboard

**What to build:** A Community-managed library of short sounds that Members can play for everyone in a Voice Room or Direct Call.

**Blocked by:** 15 — Join a live Voice Room; 16 — Place consent-based Direct Calls

**Status:** resolved

- [x] Owner and Admin can upload, preview, order, update, and delete MP3, WAV, and Ogg sounds.
- [x] Uploads are limited to 1 MiB and validated by the server against a configurable 1–30 second Community duration limit (10 seconds by default).
- [x] `manage_soundboard` and `use_soundboard` are separate Role and channel-override Permissions with safe built-in defaults.
- [x] Members with permission can open the soundboard in Voice Rooms and Direct Calls.
- [x] Each accepted play command broadcasts an authoritative event to the active Media Session; clients fetch and play the approved stored clip locally.
- [x] Sound playback is independent of microphone mute and intentionally has no cooldown or overlap restriction.
- [x] Desktop and mobile screenshot baselines cover the soundboard administration surface.

## Answer

Implemented durable SQLite metadata and private on-disk clip storage, server-side format/duration validation, permission-gated CRUD and audio APIs, Community settings, embedded administration UI, and synchronized playback over the existing versioned media WebSocket. The one binary remains self-contained and requires no external transcoder.
