# 23 — Expose safe operations and resource controls

**What to build:** A Community Owner can understand Instance health and resource pressure without leaking communication or secrets, while storage and security failures degrade predictably instead of acknowledging lost data.

**Blocked by:** 11 — Upload and safely retrieve Attachments; 20 — Relay media from restrictive networks; 21 — Back up, restore, and migrate an Instance

**Status:** ready-for-agent

- [ ] Structured stdout logs contain operational context but exclude Message bodies, passwords, tokens, Session identifiers, and Relay secrets.
- [ ] Authenticated administration diagnostics report database, storage, listener, certificate, SFU, Relay, backup, and migration health.
- [ ] An optional Prometheus endpoint is disabled by default and exposes no Member/content labels.
- [ ] Low-disk thresholds and a reserved margin reject risky new uploads before filesystem exhaustion.
- [ ] SQLite or disk write failure never produces a successful persistent-action acknowledgement.
- [ ] Safe reads and live media continue where possible during persistent-storage failure, with a prominent operator alert.
- [ ] Community-facing limits are configurable within hard ceilings; authentication and Relay safety limits cannot be disabled.
