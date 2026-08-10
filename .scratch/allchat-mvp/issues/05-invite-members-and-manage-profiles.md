# 05 — Invite and manage Member profiles

**What to build:** The Owner can admit people through controlled Invitations, and each admitted Member can maintain a stable local identity and public profile without receiving unintended authority.

**Blocked by:** 03 — Manage Sessions and account recovery; 04 — Manage Roles and ownership

**Status:** resolved

- [x] Authorized Members create Invitations with expiry and maximum-use count and can revoke them.
- [x] Registration accepts only a valid, unexpired, unrevoked Invitation with remaining uses.
- [x] Invitation consumption and account creation are atomic under concurrent redemption.
- [x] Every invited account receives only the base Member Role regardless of the Invitation creator's authority.
- [x] Usernames are unique under case-insensitive comparison and may be changed without changing Member identity.
- [x] Members can set an optional non-unique Display Name and upload or remove an avatar within safe limits.
- [x] Profile changes are visible after restart and never invalidate identity-based references.
