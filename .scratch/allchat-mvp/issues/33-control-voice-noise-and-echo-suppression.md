# Control Voice noise and echo suppression

Type: task
Status: claimed

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

- Keep WebRTC echo cancellation as the baseline. Web enhanced mode may add the pinned RNNoise 0.2-compatible WASM processor with browser suppression disabled so the two suppressors are never stacked.
- Add a shared browser microphone-capture module backed by `localStorage` and a mobile settings store backed by the existing keychain adapter.
- Existing users receive enabled defaults when no valid stored preferences exist.
- Web delivery requires rebuilding/redeploying the server; mobile delivery requires rebuilding the application. No database migration is needed.

## Comments

- The current clients already request all three processing constraints directly in each microphone capture path. This task consolidates that behavior, makes it configurable and observable, and verifies it across Voice Channels and Direct Calls.
- Expanded to cover device-local microphone/audio-route/camera selection, 0–200% outgoing gain, 0–100% master and per-Member incoming volume, and a configurable noise gate. Defaults are echo/noise suppression on, AGC off, gate on at -50 dBFS, and 100% volume.
- Implemented scoped web localStorage and Android keychain settings, settings pages, centralized web capture, Web Audio gain/gating with compatibility fallback, Android native communication-route selection, native WebRTC track volume, stats-driven Android gating, applied/requested diagnostics, and settings use across Voice Rooms and Direct Calls.
- Automated verification passes: full Go/acceptance/TURN, 77 mobile unit tests, TypeScript and ESLint, Android debug APK, 125 Playwright tests (one benchmark skipped), and Chromium media interoperability.
- Remaining before resolution: physical Android speaker/wired/Bluetooth acoustic qualification, including quiet speech, double-talk, route changes, and measured gate attenuation. The planned PCM-level owned WebRTC fork was not needed for the current implementation; revisit it if device testing shows stats-driven gating is too coarse or unavailable on supported handsets.
- Added the first enhanced-suppression slice on web: a local AudioWorklet buffers 48 kHz mono capture into RNNoise's 480-sample frames, preserves WebRTC echo cancellation, fails open to standard browser suppression, and is embedded into release binaries after the pinned npm preparation step. Android enhanced processing still requires a native PCM hook and remains follow-up work.
- Split the owned RNNoise follow-up into `.scratch/rnnoise-fork/issues/01-web-rnnoise-runtime.md` and `.scratch/rnnoise-fork/issues/02-android-native-rnnoise.md`. The Android route owns both the WebRTC AAR and React Native wrapper because the current wrapper consumes an opaque Jitsi WebRTC binary.
