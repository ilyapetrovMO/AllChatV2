# Shared desktop member panel

Approved and implemented on 2026-09-09. The final placement spans the community rail and conversation sidebar, with an 8px inset at the navigation area's sides and bottom. The rail's Add Community button sits above the card. Settings hide the rail and contain the card within their own navigation column. Account and call labels truncate; audio controls retain their size.

Penpot file: `c828d3cf-7d4e-8145-8008-9a4f1a6ff37f`.
Applied to 79 screens: Main 37, Settings 27, Voice Rooms 9, DMs & Direct Calls 6. Voice Rooms also includes compact combined-navigation examples, audio popovers, and signal states. Shared member-panel components: connected `0c38e92e-1d02-8058-8008-9d1dec61a7a4`, muted `0c38e92e-1d02-8058-8008-9d1dec821fe4`, idle `0c38e92e-1d02-8058-8008-9d1decb92005`.

Saved checkpoint: **Approved member panel — full navigation width, plus above, implemented — 2026-09-09**. Final geometry audit found no children outside any of the 79 panels.

The renderer shares the same account panel across conversations and settings. Connected calls add camera, screen sharing, activities and soundboard above it. Microphone and headphones controls persist mute/deafen, devices, processing profile and volumes through the existing voice preferences. The input meter releases its own capture when closed. Settings changes update live audio; microphone source replacements are serialized.

Ping uses the selected WebRTC candidate pair's RTT. Green: below 150ms, yellow: 150–299ms, red: 300ms or higher. Missing stats are unknown; disconnected media is red. Camera and screen sharing currently use one outgoing video slot and switch between sources.

Validation: 143 desktop unit tests, TypeScript, production-CSP stylesheet check, and packaged Linux build passed. `node desktop/scripts/check-member-panel.mjs` verifies the actual renderer at combined navigation widths 264–360px, account truncation, control containment, plus-button placement, audio popovers, soundboard, returning to voice, settings and disconnect.
