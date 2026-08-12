# WebRTC testing practices

AllChat's media tests follow the layered pattern used by mature WebRTC stacks: deterministic state tests, real peer integration, cross-client interoperability, seeded network faults, and long-running load/soak tests.

## Primary-source findings

- Chromium's PeerConnection E2E framework uses synthetic peers, scheduled call actions, per-second stats, frame matching, RTC event logs, and pluggable quality reporters. Its network emulator applies directional bandwidth, delay, and loss. [Framework](https://webrtc.googlesource.com/src/+/HEAD/test/pc/e2e/g3doc/index.md), [architecture](https://webrtc.googlesource.com/src/+/HEAD/test/pc/e2e/g3doc/architecture.md), [network emulator](https://webrtc.googlesource.com/src/+/HEAD/test/network/g3doc/index.md)
- WebRTC Stats exposes packet/byte progress, decoded and rendered frames, freezes, packet loss, jitter, concealed audio, audio energy, RTT, candidate pairs, and playout delay. Tests must assert progress through these signals rather than rely on connection-state text. [WebRTC Stats](https://www.w3.org/TR/webrtc-stats/), [WebRTC 1.0](https://www.w3.org/TR/webrtc/)
- Web Platform Tests and Playwright projects run the same behavior against independent Chromium, Firefox, and WebKit implementations. Playwright provides isolated contexts, permissions, traces, and flaky-test classification; Chromium provides deterministic fake-media switches. [WPT](https://github.com/web-platform-tests/wpt), [Playwright projects](https://playwright.dev/docs/test-projects), [permissions](https://playwright.dev/docs/api/class-browsercontext), [fake media](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc)
- Linux `tc netem` affects UDP media as well as signaling and supports seeded delay, jitter, rate, loss, corruption, duplication, and reordering. [tc-netem](https://man7.org/linux/man-pages/man8/tc-netem.8.html)
- coturn ships `turnutils_uclient` for concurrent UDP/TCP/TLS, channels/send indications, REST credentials, negative cases, and message verification. [coturn test client](https://github.com/coturn/coturn/wiki/turnutils_uclient)
- SFU capacity is measured as publishers, subscribers, tracks, simulcast layers, and visible subscriptions—not only connection count. [LiveKit benchmarking](https://docs.livekit.io/transport/self-hosting/benchmark), [Pion WebRTC bench](https://github.com/pion/webrtc-bench)
- Android managed devices provide reproducible emulator images and sharding. Android still recommends hardware validation before release; AllChat retains that as a manual check. [Managed devices](https://developer.android.com/studio/test/managed-devices), [hardware guidance](https://developer.android.com/studio/run/device.html)

## Consequences for AllChat

Every media result must be based on advancing media counters or changing rendered frames. Every fault is seeded and reproducible. Every failure retains sanitized client/server timelines, stats, browser traces, Android logs, and the exact network profile. Voice Rooms and Direct Calls run through one lifecycle module and the same scenario catalogue so one cannot silently diverge from the other.
