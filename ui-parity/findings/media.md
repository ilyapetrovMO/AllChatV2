# Calls and Voice parity findings

## Active discrepancies

- Voice-channel selection now initiates the connection directly, matching web; there is no secondary Join Voice CTA.
- Electron has authenticated signaling, WebRTC transport, and polled participant stage/sidebar rendering; the connected visual state still needs packaged cross-client verification.
- Participant profile/context actions and owner mute/disconnect moderation controls are implemented; their packaged visual state remains unverified.
- Incoming, outgoing, connected, ended, and failed Direct Call states are not yet covered by a deterministic two-client parity fixture.
- Device selection, processing, input/output volume, permission failures, and persisted Voice & Video preferences are absent from Electron settings.

## Required verification

Use two isolated authenticated clients and deterministic fake media devices. Verify caller and recipient states, controls, participant membership, recovery after hang-up, and the Voice Room join/leave flow against the web accessibility tree and rendered UI.
