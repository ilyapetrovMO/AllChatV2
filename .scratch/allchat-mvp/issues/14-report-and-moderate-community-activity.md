# 14 — Report and moderate Community activity

**What to build:** Members can request moderator review, and authorized moderators can take proportionate, accountable action without retaining secret copies of deleted Message content.

**Blocked by:** 04 — Manage Roles and ownership; 10 — Add rich Message interactions; 13 — Exchange Direct Messages and enforce Blocks

**Status:** paused — moderation foundation is implemented; live-media sequence takes priority

- [ ] A Member can Report visible content or another Member with a reason and can see the Report's open/resolved state.
- [ ] Authorized moderators resolve Reports with a recorded outcome; reporting alone never applies punishment.
- [ ] Warnings, temporary timeouts, kicks, Suspensions, Invitation revocations, and moderator Message deletion enforce their documented effects.
- [ ] Every action records actor, target, reason, time, and outcome in an append-only Moderation Record.
- [ ] Moderator Message deletion permanently removes the body rather than retaining it in the Moderation Record.
- [ ] Only Members with audit-view Permission can read the Moderation Record.
- [ ] Old records can be purged only through an explicit Owner maintenance action whose occurrence is itself recorded.
