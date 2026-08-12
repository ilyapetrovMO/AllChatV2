# Test media through one shared lifecycle

Voice Rooms and Direct Calls will share capture, signaling, track ownership, renegotiation, recovery, statistics, and teardown implementations on each client platform. Ringing, consent, admission, and presentation remain distinct.

Media behavior is tested through a scenario interface implemented by Pion, browser, and Android adapters. Tests observe structured media events and WebRTC statistics rather than implementation state or UI labels. Test/debug builds may expose deterministic capture and diagnostics controls; production builds must not expose that control surface.

Pull requests run deterministic state tests, real Pion/SFU integration, Chromium interoperability, and one Android emulator smoke lane within a fifteen-minute target. Full browser and Android matrices run on the main branch and release gate. Seeded impairment, TURN, repetition, load, and soak run nightly. Physical Android audio-route checks remain manual until a device lab is adopted.
