# 25 — Qualify and package the MVP release

**What to build:** An operator can download a verifiable AGPL release, install it on a clean supported VPS, and rely on the documented security, durability, media, upgrade, and capacity envelope as one coherent MVP.

**Blocked by:** 18 — Moderate live media; 20 — Relay media from restrictive networks; 22 — Export and delete Member data; 23 — Expose safe operations and resource controls; 24 — Polish the accessible embedded web client

**Status:** ready-for-agent

- [ ] Reproducible release automation produces Linux `amd64` and `arm64` binaries with checksums and license/source notices.
- [ ] A clean VPS goes from binary and documented network configuration to a secured Community without mandatory external services.
- [ ] Two invited Members complete Text Channel, search, Reply, Attachment, Direct Message, Direct Call, Voice Room, and screen-share journeys.
- [ ] Direct and forced-relay media paths, Permission changes, moderation, restart, backup/restore, and binary-replacement upgrade pass end to end.
- [ ] Security acceptance covers authentication throttling, CSRF, safe rendering/downloads, authorization leaks, secret-free logs, and Relay destination controls.
- [ ] Load qualification covers 500 registered Members, 100 concurrent web connections, and 25 participants in one Voice Room with documented resource measurements.
- [ ] Operator and privacy documentation states ports, data ownership, trusted-operator visibility, limits, recovery, upgrade, and unsupported boundaries accurately.
