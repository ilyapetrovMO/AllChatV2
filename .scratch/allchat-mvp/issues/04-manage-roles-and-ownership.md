# 04 — Manage Roles and ownership

**What to build:** The Community Owner can delegate authority through ordered Roles and named Permissions without allowing administrators to manage peers, escalate themselves, or create a second Owner.

**Blocked by:** 02 — Bootstrap the Community Owner

**Status:** resolved

- [x] A fresh Community contains immutable Owner, Admin, Moderator, and Member default Roles with documented Permissions.
- [x] The Owner can create, rename, order, edit, and retire custom Roles through the API and embedded UI.
- [x] A Member may hold multiple Roles and receives their combined Community-wide Permissions.
- [x] No Member can manage a Member or Role at or above their own highest Role.
- [x] The Owner Role remains unique and cannot be deleted or assigned by ordinary Role management.
- [x] Ownership transfer requires fresh authentication, explicit confirmation, and atomically demotes the former Owner.
- [x] Authorization failures reveal no hidden administrative data and are covered at the public Instance seam.
