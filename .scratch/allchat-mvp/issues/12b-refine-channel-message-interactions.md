# 12B — Refine Discord-like Channel interactions

**What to build:** Present image Attachments inline, move Message editing into the bottom composer behind hover/focus actions, and expose authorized Message search from the Channel header in a right-side results pane.

**Blocked by:** 12A — Establish Discord-like embedded UI foundation

**Status:** resolved

- [x] Image Attachments render directly with constrained responsive previews while other files remain downloadable links.
- [x] A Member's Message exposes Edit and Delete actions only on hover or keyboard focus.
- [x] Edit reuses the normal Message composer, clearly indicates edit mode, and supports Save, Cancel, and Escape.
- [x] The composer remains attached to the bottom of the viewport while Message history scrolls independently.
- [x] Search remains visible in the Channel header and opens authorized results in a right-side pane.
- [x] Internal tests, the full acceptance suite, vet, and Linux amd64/arm64 builds pass.

## Answer

The Channel interface now follows Discord's core interaction model for media, editing, composer placement, and search without changing the established authorization, CSRF, persistence, or search contracts.

## Comments

- Inline previews use the persisted Attachment content type and retain lazy loading and descriptive alternative text.
- Search consumes the existing permission-filtered `/api/v1/search` endpoint and builds result markup with DOM text nodes.
- Fixed the edit banner's initial visibility by explicitly preserving `display: none` when the component has the `hidden` attribute; covered by a Playwright regression on desktop and mobile.
- Added a Discord-style bottom-left Member panel with avatar/fallback initial, realtime Presence indicator, a keyboard-accessible avatar menu for Presence mode, account switching, and Member ID copying, plus a User Settings cog.
- Disabled completion, correction, capitalization, and spellcheck suggestions on ordinary text controls while retaining explicit authentication autocomplete metadata. Conversation history now follows realtime Messages only when the Member remains near the bottom, preserving their position after they scroll upward.
- Added a 120px follow threshold and a bottom “Jump to present” prompt. The prompt appears when a Member leaves the current conversation position and disappears when clicked or when they manually return near the bottom, resuming realtime following in either case.
- Fixed realtime Message identity parity: Message payloads now include author avatar URLs, realtime inserts render the same avatar or initial fallback as initial history, and composer sends/edits use the JSON API without a full-page flicker.
- Made conversation following media-aware: late image loads and video metadata growth keep the current Message anchored only while auto-follow is active, while Members reading older Messages retain their scroll position and jump prompt.
