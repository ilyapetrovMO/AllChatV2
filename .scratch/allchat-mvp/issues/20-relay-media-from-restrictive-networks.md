# 20 — Relay media from restrictive networks

**What to build:** Members whose networks cannot connect directly can use the Instance's embedded Pion TURN Relay while operators retain bounded, authenticated, and observable control over relay exposure and cost.

**Blocked by:** 15 — Join a live Voice Room; 19 — Secure public web traffic

**Status:** resolved

- [x] The embedded Relay is enabled with media when its required public address is configured and may be disabled in favor of configured external TURN.
- [x] UDP/TCP listeners, optional TURN/TLS, bounded UDP relay range, and advertised public address are validated boot settings.
- [x] Authenticated Members obtain short-lived per-Member credentials; static browser credentials are never exposed.
- [x] Allocation count, rate, bandwidth/resource quotas, and credential issuance are bounded.
- [x] Relay permissions deny loopback, private, link-local, multicast, and cloud-metadata destinations.
- [x] Forced-relay real WebRTC tests pass and prove credential expiry and quota behavior.
- [x] VPS private-bind/public-advertised mapping and external-TURN mode are verified and documented.

## Answer

Embedded Pion TURN now provides UDP/TCP 3478, TURN/TLS 5349 with Instance TLS, a bounded UDP relay range, short-lived REST credentials, per-Member allocation and issuance limits, safe destination policy, and clean shutdown. External TURN REST mode and VPS public/private mapping are documented. A real Pion peer is forced through the relay in integration coverage, alongside expired-credential tests.
