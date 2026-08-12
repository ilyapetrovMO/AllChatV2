# Control Voice noise and echo suppression

Type: task
Status: ready-for-agent

## Goal

Centralize microphone capture for Voice Channels and Direct Calls, and give Members device-local control over WebRTC echo cancellation, noise suppression, and automatic gain control in both the web and mobile clients.

## Acceptance criteria

- A shared `VoiceProcessingSettings` model contains independent `echoCancellation`, `noiseSuppression`, and `autoGainControl` booleans, all enabled by default.
- Every web microphone path and the mobile `MediaSession` use the same settings-driven capture interface; camera and screen-capture constraints remain unchanged.
- Web preferences are stored locally and scoped by Member; mobile preferences use existing device-only storage and are scoped by Instance and Member.
- A Voice & Audio section in web and mobile user settings exposes all three toggles.
- Changes save immediately but apply only to the next Media Session; an active call clearly communicates this without restarting or renegotiating its microphone track.
- Unsupported or ignored constraints never block a call. The client continues with best-effort capture and presents a concise compatibility notice.
- Existing Voice diagnostics include requested and applied processing state where the platform exposes track settings.
- No backend schema, signaling protocol, or SFU behavior changes are required.

## Test plan

- Unit-test enabled defaults, persistence, corrupt-value recovery, account scoping, and generated audio constraints.
- Verify full-page Voice, sidebar Voice, web Direct Calls, mobile Voice Channels, and mobile Direct Calls all cross the shared capture seam.
- Cover independent toggle combinations and confirm video capture constraints are unaffected.
- Cover unsupported constraints and fallback without rejecting microphone capture.
- Verify edits made during an active call are persisted without changing its active track.
- Add web and mobile UI coverage for controls, compatibility/apply-next-call notices, and persistence after reopening settings.
- Manually test two devices using speakers for echo reduction and background noise suppression, then inspect requested/applied diagnostic values.

## Implementation notes

- Use the WebRTC processing supplied by the browser or native WebRTC implementation; do not add custom DSP or a new media dependency.
- Add a shared browser microphone-capture module backed by `localStorage` and a mobile settings store backed by the existing keychain adapter.
- Existing users receive enabled defaults when no valid stored preferences exist.
- Web delivery requires rebuilding/redeploying the server; mobile delivery requires rebuilding the application. No database migration is needed.

## Comments

- The current clients already request all three processing constraints directly in each microphone capture path. This task consolidates that behavior, makes it configurable and observable, and verifies it across Voice Channels and Direct Calls.
