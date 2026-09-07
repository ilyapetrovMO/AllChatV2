# Media test contract

## Endpoint interface

Every Pion, browser, and Android test endpoint supports: join or accept, leave, crash, rejoin, microphone mute, camera and screen start/stop, viewer visibility, background/foreground, signaling loss, media loss, ICE restart, event collection, and a media snapshot.

Structured events use schema `allchat.media.test/v1` and contain a test run ID, scenario ID, endpoint, monotonic timestamp, session kind, room/call ID, signaling generation, peer lease where available, connection states, track owner/kind/source/generation, first/last media progress, and recovery outcome. Snapshots contain sanitized candidate type/protocol plus packet, byte, loss, jitter, RTT, audio sample, decoded/rendered frame, freeze, and concealment counters. Credentials, raw SDP, candidate addresses, real Member IDs, and media contents are forbidden.

## Required scenarios

The manifest in `media-tests/scenarios.json` is authoritative. Applicable lifecycle scenarios run for both Voice Rooms and Direct Calls. Direct Calls run web-to-Android, Android-to-web, web-to-web, and Android-to-Android directions in the full tier.

## Pass criteria

- Baseline signaling and media connect within 10 seconds.
- Audio packets, bytes, and received sample duration advance over three consecutive one-second observations.
- Video decoded frames advance and at least three rendered-frame hashes change within five seconds.
- Expected track owners and participant tiles match exactly; no duplicate, unnamed, muted, black, or stale tile is allowed.
- Stopped media disappears and stops advancing within three seconds.
- Restarted media advances as a new generation within five seconds and the old generation never returns.
- A two-second outage recovers within ten seconds. A ten-second outage recovers within the existing thirty-second budget or terminates and releases capture.
- Explicit leave removes participation and releases capture within three seconds.

Retries collect another artifact set but remain a failure when only the retry passes. Quarantine requires a tracked issue, owner, deterministic seed, and expiry within fourteen days.

## Running the implemented tiers

- `make test-media-manifest` validates the authoritative scenario catalogue.
- `go test ./internal/media ./internal/relay` exercises real Pion peers, late publishers/viewers, multi-publisher routing, renegotiation, keyframe requests, session leases, and TURN credentials.
- `make test-media-browser` launches two isolated real-browser clients against a temporary real AllChat instance. Set `ALLCHAT_MEDIA_BROWSER=chromium|firefox|webkit`. It verifies advancing two-way audio/video, video start/stop/restart, simultaneous publication glare, signaling recovery, audio RTP continuity, and post-recovery video restart for both Voice Rooms and Direct Calls. Use `ALLCHAT_MEDIA_ONLY=baseline|video-restart|quality|glare|signaling-recovery` for a focused loop.
- `npm run test:media:lifecycle` runs web capture, ownership and signaling regressions.
- `npm run build:desktop` followed by `xvfb-run -a npm run test:media:desktop` (Linux) runs the production Electron controller against the real SFU and a browser endpoint for Voice Rooms and Direct Calls. Audio samples and video frames must advance and leaving must release capture and peers.
- `ALLCHAT_MEDIA_ITERATIONS=20 make test-media-soak` repeats the browser lifecycle and stops at the first failure.
- `sudo media-tests/network/netem.sh apply <device> mobile` installs a seeded impairment profile; always run the matching `clear` command afterward. Run this only on an isolated CI/test network interface.

Failures write sanitized JSON beneath `.dev/media-tests/`, which CI retains. The GitHub media workflow runs Pion, Chromium, desktop interoperability and Android build/tests on pull requests. Other runs add Firefox and WebKit; scheduled runs also repeat Chromium for soak coverage. The Android emulator lane checks application launch, not native media interoperability.

The manifest describes the target suite. Today the automated real-browser adapter covers baseline two-way media, video replacement, simultaneous publication, quality changes, and active-video signaling recovery for Voice Rooms and Direct Calls. Remaining Android interoperability, impairment, forced-Relay, and capacity scenarios are tracked under `.scratch/webrtc-reliability-suite/`; a scenario is not considered implemented merely because it appears in the manifest.

Implementation evidence and remaining qualification are catalogued in [the September reliability report](research/webrtc-reliability-implementation.md).
