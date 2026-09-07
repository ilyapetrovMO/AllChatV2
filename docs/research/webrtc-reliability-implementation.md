# WebRTC reliability implementation — September 2026

The implementation addresses capture ownership, recovery, signaling and forwarding across web, Electron and React Native. The audit and individual work items are in `.scratch/webrtc-reliability-audit/`.

Automatic recovery never takes a session from another device. Explicit Join may take ownership. Full peer replacement stops camera and screen capture; restarting video requires Member action. Microphone mute survives recovery. Recovery has a 30-second budget and bounded attempts.

## Findings and changes

| # | Finding | Implemented change | Evidence / remaining qualification |
|---|---|---|---|
| 01 | Mobile capture survives cancellation | Generation checks release late microphone results and stale setting replacements. | MediaSession cancellation tests. |
| 02 | Desktop provisional resources leak | Attempt disposer owns capture, peer and socket before connection finishes. | Actual DirectCallControls unmount/deferred-operation tests. |
| 03 | Web capture wrapper teardown is lost | Preparation owns both raw capture and processing cleanup when another dependency fails. | Late-capture rejection regression and web terminal cleanup tests. |
| 04 | Video acquisition races leave/reconnect | Serialize source changes, reject obsolete picker results and own acquired tracks before later awaits; roll back failures. | Mobile source tests, web generation checks, desktop screen lifecycle. Native picker cancellation still needs device qualification. |
| 05 | Desktop lacks bounded recovery | Shared Voice Room/Direct Call controller retains microphone/mute, refreshes credentials, retries with the resume token and bounds attempts. | Controller/signaling tests and real Electron Voice Room/Direct Call media. Desktop network-outage qualification remains. |
| 06 | Mobile retries terminal errors incorrectly | Clear invalid resume tokens; stop on moderation, supersession, authorization and ownership errors; never auto-takeover. | MediaSession recovery tests. |
| 07 | Half-open or stalled connections persist | Attempt deadlines, heartbeat age checks, negotiation deadlines and one recovery budget. | Web half-open/stalled-credentials tests; desktop offer-timeout test; mobile lifecycle tests. |
| 08 | SFU detaches on transient disconnection | Ten-second ICE disconnect grace; cancel it when connected and validate lease/state on expiry. | Pion/Manager regressions under the race detector. |
| 09 | Stale signaling mutates a replacement session | Every mutating media command checks the peer lease; stale cleanup and broadcasts cannot target its replacement. | Stale-lease regression and race tests. |
| 10 | Offer collisions and delayed answers | Correlated offer IDs, queued negotiation, obsolete-answer filtering and transaction deadlines. Reserve media slots to avoid routine topology changes. | Web/desktop signaling tests and real simultaneous publication scenarios. |
| 11 | Web retains old video transceivers | Each peer owns a fresh reserved video sender; recovery clears receiver state. | Web lifecycle regression and browser recovery/restart. |
| 12 | Mobile video state survives full recovery | Stop capture and reset camera/screen UI on peer replacement. | MediaSession tests; physical device qualification outstanding. |
| 13 | Direct Call stop events affect the wrong video | Filter events by owner, retain muted receiver identity, clear obsolete peer media. | Production web Direct Call UI regression. |
| 14 | Forwarding senders do not consume RTCP | Each sender drains feedback; NACK interception retransmits; PLI/FIR targets the selected source. | Real Pion NACK/retransmission test and existing keyframe feedback tests. |
| 15 | Simulcast switches break RTP continuity | Stable subscriber output, keyframe-gated switching, sequence/timestamp/PictureID continuity, publisher transport extensions removed. | Pion continuity test and decoded browser quality-switch scenarios. Wider codec/network qualification remains. |
| 16 | SFU selects a disabled publisher layer | Add publisher-quality command; desktop announces its active maximum before disabling encodings. | Server selection logic and real quality switching. Multi-viewer adaptive-load qualification remains. |
| 17 | Quality changes resurrect stopped video | Gate initial subscriptions, late layers, quality changes and every forwarded packet on publication state. | Pion stopped-source test and browser stopped-quality-change scenario. |
| 18 | Reconnect reuses stale Relay credentials | Fetch credentials for each attempt and ICE restart. | Web fresh-credential and ICE-restart regressions. Forced-Relay expiry qualification remains. |
| 19 | Display audio has no consistent owner | Separate reserved display-audio sender; detach it on source stop/recovery. | Cross-client lifecycle tests; operating-system display-audio capture still needs qualification. |
| 20 | Multiple audio tracks replay one stream | One playback stream per received audio track, retaining Member volume attribution. | Web UI two-receiver regression and bidirectional decoded audio tests. |
| 21 | Publication resources accumulate | Reuse media slots, remove departed-member senders and continuity state, identify audio by negotiated slot across recovery. | Manager cleanup regression, repeated video lifecycle tests. Long-duration capacity/heap soak remains. |
| 22 | Optional command rejection tears down media | Scoped command-error frames stay nonfatal; corrected desktop sound asset field. | Web/desktop command rejection tests and Instance tests. |
| 23 | Android route/service outlives media | Honor saved route, react to device removal/addition, serialize foreground service operations, stop on terminal media state. | Kotlin compilation, audio test and foreground-service race regressions. Physical Bluetooth/wired/projection qualification remains. |
| 24 | Tests miss shipped lifecycle failures | Extend real browser recovery with active video and decoded audio; add quality switching, Electron production Voice Room/Direct Call interop, capture regressions and CI lanes. | Implemented tiers below. Native interop, impairment and long soak remain open. |

## Executed validation

- `go test -race ./internal/media ./internal/relay ./internal/instance` passes, including a real retransmission requested by NACK.
- Desktop suite: 108 tests passed, including the offer-timeout regression. Desktop TypeScript checking and production packaging pass.
- Mobile suite: 110 tests passed, including two foreground-service race tests; a subsequently added stale-video regression passes with its 28-test MediaSession file. Mobile TypeScript checking passes.
- Web foundation: 27 Chromium tests pass. Five standalone web lifecycle regressions pass.
- Full Chromium, Firefox and WebKit runs pass baseline, source restart, simultaneous publication, quality switching and active-video signaling recovery in both session types.
- Real Electron-to-web Voice Room and Direct Call audio/video, screen restart and capture/peer cleanup pass.
- `ANDROID_HOME=/home/gosha/Android/Sdk ./gradlew :app:compileStandaloneKotlin --no-daemon` passes. No Android device is attached and no local emulator executable is installed. Compilation is not native media qualification.

Three uninterrupted Chromium soak iterations pass with real audio/video playback elements. During expanded browser development, video-stop observations intermittently exceeded the four-second test window. The runner retains counter history on this failure. A passing focused rerun does not establish soak reliability; keep this visible in finding 24 until repeated runs establish the cause and bound. The suite does not retry or quarantine failures automatically.

## Signaling compatibility

Version 1 remains supported. Clients opt into `capabilities: ["negotiation-id"]` on Join and attach a `negotiation_id` to offers and answers. Updated clients use `client-N`; the SFU uses `server-N`. Answers echo the originating ID. The SFU requires a matching answer ID only for opted-in peers. Command rejections use `type: "command-error"`, `scope`, `code`, and `error`; they do not terminate media. `publisher-quality` carries `low`, `medium` or `high` and is lease-scoped.

## Outstanding qualification

No claim is made that all scenarios in the media manifest are implemented or passed. Remaining work includes physical Android audio routes and MediaProjection, real Android-to-web/desktop calls, Windows/macOS capture and display audio, forced Relay credential expiry, seeded packet-loss/outage scenarios, capacity and long-duration resource measurements. See `docs/media-testing.md` and finding 24 for the runnable tiers and remaining scope.
