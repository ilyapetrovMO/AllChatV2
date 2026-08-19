# Calls and Voice parity findings

## Active discrepancies

- Voice-channel selection now matches web: the first click connects without leaving the current view, while clicking the connected channel opens its grid; there is no secondary Join Voice CTA.
- Connected Call and Voice controls use the web hierarchy: a compact connection panel directly above the bottom-left Member panel, with icon-only microphone and disconnect actions and no connected-state controls in the conversation header.
- Electron polls every visible Voice Channel and renders its participants beneath the channel name even when another conversation is open. Authenticated signaling and WebRTC transport exist; the connected visual state still needs packaged cross-client verification.
- Participant profile/context actions and owner mute/disconnect moderation controls are implemented; their packaged visual state remains unverified.
- Incoming, outgoing, connected, ended, and failed Direct Call states are not yet covered by a deterministic two-client parity fixture.
- Device selection, processing, input/output volume, permission failures, and persisted Voice & Video preferences are absent from Electron settings.

## Required verification

Use two isolated authenticated clients and deterministic fake media devices. Verify caller and recipient states, controls, participant membership, recovery after hang-up, and the Voice Room join/leave flow against the web accessibility tree and rendered UI.
