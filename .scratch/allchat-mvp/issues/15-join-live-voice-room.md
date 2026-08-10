# 15 — Join a live Voice Room

**What to build:** Authorized Members can join one visible Voice Room at a time, exchange live Opus audio through an embedded Pion SFU, see all participants, and recover briefly from connection loss.

**Blocked by:** 06 — Organize visible Community channels; 08 — Deliver resumable realtime events

**Status:** resolved

- [x] The versioned WebSocket protocol negotiates real Pion WebRTC audio for an authorized Voice Room.
- [x] Every participant is visibly listed and no hidden listening mode exists.
- [x] A Member may have only one active Media Session per Instance.
- [x] Joining another Voice Room requires an explicit transition rather than silently retaining both sessions.
- [x] A transient disconnect can resume within the configured Rejoin Window; expiry removes the participant.
- [x] Process restart ends all Media Sessions clearly and clients do not present stale participation.
- [x] Configurable conservative audio bitrate/resource ceilings protect a self-hosted VPS.

## Progress

- Pinned Pion WebRTC v4.2.13 and added a process-local shared Media Session authority.
- Enforced one active Media Session per Member, explicit leave-before-transition behavior, visible participant snapshots, 15-second token-bound rejoin, and restart cleanup.
- Added deterministic state-machine tests. The next slice is the authenticated versioned WebSocket signaling protocol and Opus SFU peer lifecycle.

## Answer

Implemented the authenticated v1 media WebSocket, real Pion Opus SFU negotiation, visible participant state, exclusive sessions, token-bound recovery, restart cleanup, bounded UDP ports, room capacity, and sender bitrate ceilings. Real ICE/DTLS/SRTP negotiation is covered by integration tests.
