# 09 — Synchronize Presence, Read Positions, and typing

**What to build:** Members see responsive conversation state across devices: aggregate Presence, synchronized Unread State, ephemeral typing indicators, and browser notifications while the embedded client is open.

**Blocked by:** 08 — Deliver resumable realtime events

**Status:** resolved

- [x] Presence is online when any Session is active, idle when all connected Sessions are inactive, and offline after the final connection plus grace period.
- [x] A Member can set do-not-disturb; invisible mode is not exposed.
- [x] Read Positions persist per Member and Text Channel and update Unread State across all Sessions.
- [x] Typing indicators are ephemeral, rate-limited, expire automatically, and are delivered only to authorized viewers.
- [x] The open embedded client requests browser-notification permission deliberately and notifies according to Presence and visibility.
- [x] Reconnect, multiple-device, idle, and final-disconnect scenarios converge without presence flicker or unread regression.
