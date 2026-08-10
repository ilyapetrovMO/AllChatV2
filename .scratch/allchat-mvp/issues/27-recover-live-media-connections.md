# 27 — Recover live Media Sessions from transport failure

**What to build:** Detect failed signaling and WebRTC transports, recover a Member's active Media Session within a bounded interval, and clearly present recovery or terminal failure without requiring routine manual rejoin.

**Status:** resolved

- [x] Acknowledged signaling heartbeats detect half-open media WebSockets.
- [x] Failed ICE first attempts an in-place restart over healthy signaling.
- [x] Transport replacement fetches fresh Relay credentials and recreates both the WebSocket and peer.
- [x] Token-bound takeover is safe when stale connection cleanup races with recovery.
- [x] Resume expiry falls back to a fresh join; terminal failure presents a manual Retry action.
- [x] Recovery has bounded backoff and a 30-second deadline.
- [x] Deterministic browser tests cover socket loss, heartbeat loss, ICE failure, credential refresh, and resume expiry.

## Answer

Implemented a shared browser Voice Connection module with explicit connection states, acknowledged liveness, ICE restart, bounded transport recreation, fresh Relay credentials, token-bound takeover, stale-peer leases, fresh-join fallback, and manual retry. Both current Voice Room and Direct Call navigation use the shared module through the embedded sidebar adapter.
