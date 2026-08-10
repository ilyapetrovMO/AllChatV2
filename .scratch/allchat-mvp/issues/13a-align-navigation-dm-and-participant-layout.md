# 13A — Align navigation, DM, and participant layout

**What to build:** Bring the embedded client closer to Discord's structural layout with a Direct Messages rail entry, Community menu, DM home, settings navigation, and conversation participant/profile pane while retaining original AllChat assets.

**Blocked by:** 13 — Exchange Direct Messages and enforce Blocks

**Status:** resolved

- [x] The top rail distinguishes Direct Messages from the single Community.
- [x] The Community header opens a keyboard-accessible administration and navigation menu.
- [x] Direct Messages have a dedicated landing view with Member discovery and existing conversations.
- [x] Text Channels show a participant pane and DMs show the other Member's profile pane.
- [x] Existing settings routes retain a cohesive Discord-like settings layout.
- [x] Desktop/mobile browser checks, acceptance, vet, and cross-builds pass.

## Answer / Comments

- Added a dedicated `/dms` landing page with Member discovery, the existing DM list, account controls, and a distinct active DM rail button.
- Added the Community switcher menu to conversation navigation with owner-only settings, invitation, and channel actions.
- Added a live Member sidebar for Community Channels and a profile card for the other Member in Direct Messages; search replaces that pane and narrow layouts collapse it.
- Presence events now update Member-list indicators without a reload.
- Verified internal packages, identity, vet, all 16 Playwright desktop/mobile checks, the full acceptance suite, and static Linux amd64/arm64 builds.
