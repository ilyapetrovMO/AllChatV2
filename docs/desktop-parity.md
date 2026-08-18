# Desktop parity matrix

This matrix is the release checklist for Member-facing web parity. A capability is complete only when its Instance contract, desktop behavior, and shared Playwright journey pass. Community Owner administration is included because the requested desktop application is a visual and functional copy of the web app.

| Capability | Instance contracts | Desktop delivery task |
| --- | --- | --- |
| Instance onboarding and Sessions | version, native login/register, session, logout, session list/revoke | 02 |
| Shell and navigation | mobile bootstrap, channels, DMs, channel state | 03 |
| Realtime and offline recovery | realtime WebSocket, snapshot, cursor, cached bootstrap | 04 |
| Channel and DM messaging | history, publish, edit, delete, read position | 05 |
| Rich Messages | attachments, replies, reactions, pins, link previews, search | 06 |
| Members and profiles | members, profile, avatar, banner, Presence, DMs, Blocks | 07 |
| Safety and moderation | Reports, Moderation Records/actions, Account export/deletion | 08 |
| Community administration | Roles, Invitations, Categories, Channels, overrides, diagnostics | 09 |
| Notifications | notification settings, realtime policy, native notifications | 10 |
| Desktop lifecycle | tray, startup, deep links, single process, logs, support export | 11 |
| Voice Rooms and Direct Calls | media config/WebSocket, calls, participants, TURN | 12 |
| Screen sharing and soundboard | screen sources, media tracks, sounds and settings | 13 |
| Distribution and qualification | Forge makers, signing, updater, SBOM, parity/a11y/performance suites | 14 |

## Parity gates

- Public interfaces under test: versioned Instance HTTP/realtime contracts, `DesktopBridge`, user-visible React feature slices, and shared Playwright journeys.
- Raw Desktop Device Session tokens never cross `DesktopBridge` and are never stored in Instance Profile state or logs.
- Every active Instance remains isolated by identity, storage partition, credentials, connection state, cache, notification policy, and navigation state.
- The desktop renderer uses bundled local code. Instance content is data, never privileged remote UI.
- Web and desktop share canonical interaction and screenshot expectations before the legacy frontend fallback is retired.
