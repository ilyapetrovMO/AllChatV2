# Milestone 30 — Expanded Voice & Video menus

Five editable static views: Noise suppression, Screen share quality, Microphone, Speaker, and Camera. All 17 option rows are present. Suppression and quality use their exact source options. Each device fixture shows System default plus two unnamed devices using the implemented fallback labels; it does not claim those devices exist on the user's machine.

Local Chromium captures with source CSS and embedded Inter inform native menu typography, 24px rows, selected highlight, focus border/glow/outline, and menu placement. The camera menu is capped at 800px and right-aligned with its 854px selector, matching the capture. The measurement DOM places selectors explicitly to compare popup appearance; it does not prove complete settings layout geometry.

All five final native SVG/PNG views were visually inspected. Checks verify option strings/rendered bounds, clipping, menu sizes/placement and absence of prototype interactions; file validation has no issues. Save and independent confirmation are recorded separately. Production code is unchanged.

## Reconstruction

Restore included milestone 27. Execute author-voice-menus.js, then settle-voice-menus.js and refresh-away.js / refresh-back.js in separate MCP requests. Export and inspect option text. Device labels in this run needed settle-device-menus.js followed by another away/back refresh; this temporarily moves those boards to the origin and changes text sizing. Execute finish-voice-menus.js only once the text renders; it applies focus styling, the menu width cap, and final board positions. Run check-voice-menus.js and inspect all five exports. Resolve refresh page IDs by name in a reconstructed file. Repository MCP SDK, Playwright and milestone 03 embedded Inter support the helper scripts.

This reconstruction backup includes prerequisites, authoring/measurement scripts, local captures, native SVG/PNG, IDs, checks and save evidence. It is not a native .penpot export or verified reimport. Selected alternatives, named/long-device fixtures, minimum-window, cross-platform native appearance, full runtime/header/font fidelity and broader desktop coverage remain open.
