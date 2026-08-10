# 17 — Share a screen in Media Sessions

**What to build:** A participant can share adaptive screen video in a Voice Room or Direct Call, with one active sharer and optional platform-provided system audio, without allowing remote device activation.

**Blocked by:** 15 — Join a live Voice Room; 16 — Place consent-based Direct Calls

**Status:** resolved

- [x] An active participant can voluntarily start and stop screen capture in a Voice Room or Direct Call.
- [x] At most one screen sharer is active per Media Session under concurrent attempts.
- [x] Simulcast screen layers are used where available and receiver selection adapts to bandwidth and visibility.
- [x] Configurable bitrate ceilings bound SFU and uplink demand.
- [x] System audio is offered only when the browser/OS exposes it and unavailable support is explained clearly.
- [x] No moderator, peer, or server operation can activate another Member's capture devices.
- [x] Disconnect, Rejoin Window, sharer departure, and process restart release screen-share ownership correctly.

## Answer

Implemented voluntary capture in rooms and calls, atomic single-sharer ownership, q/h/f browser simulcast with full-layer SFU forwarding and visibility-driven sender adaptation, configurable ceilings, optional platform system audio, and lifecycle cleanup. Capture can only begin from the local browser gesture.

## Comments

- The primary persistent Voice controller now exposes screen sharing without ending media during SPA navigation. A second click on the connected Voice Room opens the responsive call stage; participant rows expose sharing state and stage tiles can be expanded.
