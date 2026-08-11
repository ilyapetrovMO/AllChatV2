# Native Member and messaging parity

Type: task
Status: resolved
Blocked by: 02

Implement Instance onboarding and switching, Community navigation, Text Channels, Direct Messages, Messages, Replies, Reactions, Pinned Messages, Attachments, link previews, search, Unread State, profiles, Presence, Blocks, Reports, and permitted moderation actions.

## Comments

- Messaging parity now includes Attachments, authenticated image/audio/video rendering, formatting, replies, edits/deletes, Reactions, Pinned Messages, search, and SSRF-safe link previews.
- Member parity now includes a Presence-sorted directory, profile cards, starting Direct Messages, available/DND controls, Blocks, and Reports.
- Added editable username/display-name controls, authenticated avatar upload/removal, owner-gated report review/resolution, and owner moderation actions for warn, timeout, kick, and suspension.

## Answer

Native Member and messaging workflows now cover the server's current Member-facing feature set. The mobile client reuses the Instance APIs and realtime model for Messages, Unread State, Presence, Direct Messages, safety controls, and moderation rather than maintaining parallel behavior.
