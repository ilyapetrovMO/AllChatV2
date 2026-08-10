# 18 — Moderate live media

**What to build:** Authorized moderators can protect a Voice Room by muting or disconnecting visible participants, with accountable Moderation Records and no capability to listen invisibly or activate devices.

**Blocked by:** 14 — Report and moderate Community activity; 15 — Join a live Voice Room

**Status:** resolved

- [x] A moderator with the correct Permission can server-mute a Voice Room participant and the effect is visible to everyone present.
- [x] The moderator can remove a participant from the Media Session without suspending the account unless separately requested.
- [x] Role hierarchy prevents moderators from acting on protected peers or superiors.
- [x] Every mute and disconnect records actor, target, reason, and outcome in the Moderation Record.
- [x] Unauthorized commands cannot infer hidden Voice Room participation.
- [x] There is no invisible-join, remote microphone activation, or remote screen-capture operation.
- [x] Rejoin behavior respects an active moderation action rather than bypassing it.

## Answer

Implemented permission- and hierarchy-checked server mute/unmute and disconnect, visible mute state, requested/failed/applied audit records with reasons, non-enumerating hidden-room behavior, and a five-minute removal cooldown that cannot be bypassed with a resume token.
