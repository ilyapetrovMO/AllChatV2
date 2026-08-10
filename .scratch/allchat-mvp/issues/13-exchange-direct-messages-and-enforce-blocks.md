# 13 — Exchange Direct Messages and enforce Blocks

**What to build:** Two Members can maintain a private persistent conversation with durable/realtime Message behavior and either Member can establish a Block that stops new interaction without erasing prior history.

**Blocked by:** 05 — Invite and manage Member profiles; 08 — Deliver resumable realtime events; 12A — Establish Discord-like embedded UI foundation

**Status:** resolved

- [x] A Direct Message has exactly two distinct Members and is discoverable only by its participants.
- [x] Participants publish, read, edit, delete, Reply, Mention, React, pin, and track Read Positions using the established conversation contracts.
- [x] Direct Message events and snapshots never reach non-participants.
- [x] Either participant can Block or unblock the other.
- [x] While blocked, neither direction permits new DM Messages, DM Reactions, or Direct Call initiation.
- [x] Prior Direct Message history remains visible to both participants during and after a Block.
- [x] Concurrent creation resolves to one persistent Direct Message for the same Member pair.

## Answer

Direct Messages use the existing conversation machinery behind a private membership seam, preserving one implementation of Message sequencing, rich interactions, Attachments, Read Positions, search, and realtime delivery. Schema version 13 adds unique two-Member conversations and directional Blocks. Block state prevents either Member from initiating new Messages and Reactions while retaining history and existing edit/delete access; `CanStartDirectCall` exposes the same guard for the later Direct Call module.

The embedded client includes Member discovery, DM navigation with avatars, the established conversation interface, and Block/unblock controls. The internal backing Channel is excluded from Community channel discovery and administration.

## Comments

- Concurrent creation from both participants resolves to the same persisted Direct Message.
- Acceptance coverage proves non-participants receive neither DM history, pages, snapshots, nor realtime events.
- Internal/cmd tests, the full acceptance suite, vet, Playwright (16 checks), and static Linux amd64/arm64 builds pass.
