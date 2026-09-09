# Milestone 23 — Notifications settings and Ringtone hover

Four static Notifications views: default Community settings, muted Community with sound off, scrolled channel overrides showing all three non-default levels, and no eligible channels. Only active Text Channels appear. The fixed Native notifications enabled indicator is retained. Synthetic general/announcements/support fixtures are used. A fifth board adds Ringtone file-selector hover from source CSS.

Sources and unimplemented combinations are listed in notification-state-audit.md. Both notification save handlers update local state before awaiting the operation and do not revert it on failure; later error references must preserve selected values. Expanded select menus, save/error notices, focus/hover, minimum-window and full runtime comparison remain pending. No new prototype interactions.

The initial authoring request timed out, but subsequent authoritative live inspection found all five boards complete. No author retry occurred. Native checks and actual SVG visual review passed. Named save independently confirmed; see confirmed-version.json. The native inspection output preserves recovery evidence.

Reconstruction: restore included milestone 20 (which includes the account base), then author-notification-settings.js on Desktop — Main. Repository MCP SDK/helper and Playwright plus milestone 03 font data support scripts. Native SVG/PNG previews, source audits, IDs, checks and save records are included. Geometry remains source-informed/manual with Inter; exact runtime/header fidelity is still pending. This is a reconstruction backup, not a native .penpot export/reimport.

Full desktop design coverage remains incomplete. The native file-picker investigation is still open; this milestone does not resolve it.
