# Milestone 38 — Minimum-window menus

Five editable static 960×640 references show microphone, speaker, suppression, camera and quality menus on the measured minimum-window form. Existing verified native menu labels are reused. Device fixtures contain two unnamed devices with source fallback numbering; they do not describe connected hardware.

Local Chromium captures from the source fixture and CSS confirm selector/menu widths: microphone and speaker 264px, suppression 172px, camera 542px and quality 108px. All five popups open below their selectors in the chosen scroll positions and remain within the window. The camera menu no longer needs the 800px cap used by the wider form. Focus styling and selected row appearance are retained.

All five native SVG/PNG views were visually inspected against captures. Checks cover minimum dimensions, popup placement, viewport fit, expected exported options and no interactions. File validation has no issues. Named save and independent confirmation are included. No prototype wiring or production code changes.

Reconstruction: restore included milestones 30 and 37 and their prerequisites. Run author-minimum-menus.js until remaining is zero (two bounded batches), check-minimum-menus.js, and inspect final exports. Repository MCP SDK, Playwright and milestone 03 Inter support helpers. The measurement fixture supplies synthetic device options for these captures.

This reconstruction backup contains prerequisites, scripts, source captures/measurements, native SVG/PNG, IDs, checks and save evidence. It is not a native .penpot export or verified reimport. Named/long/empty device fixtures, minimum camera-on, full native-control/header/font fidelity and broader desktop design coverage remain open.
