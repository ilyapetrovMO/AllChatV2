# Milestone 20 — Ringtone settings

Seven static native views cover generated/Community fallbacks, custom audio, successful upload, failed upload from inactive state, reset to Community ringtone, and muted volume. Each includes Ringtone navigation, incoming-call ringtone file input, the conditional Use Community default control, and volume range/output. Source-defined notices are represented without invented upload progress or Save buttons.

Sources and remaining variants are listed in ringtone-state-audit.md. Historical local Electron default screenshot supplied layout reference; no screenshot was uploaded. Positions are manually source-informed, with the existing Inter convention. Exact runtime geometry, typography, inherited shell/header fidelity and native control details still require comparison. This milestone establishes visible native designs and source control coverage, not full screen completion.

All seven native SVG renders visually inspected. Expected labels, conditional reset control, notice and volume checks pass, with no interactions and no native file-validation issues. Saved version independently confirmed; see confirmed-version.json. No new prototype wiring or production code change.

The image-picker capture investigation remains unresolved: input activation and direct Electron showOpenDialog did not yield a visible picker in an isolated Xvfb display. The capture is retained as diagnostic evidence only and does not count as a picker design. All capture processes exited; no current wait is pending.

Reconstruction order: included milestone 16 settings base, then author-ringtone-settings.js on Desktop — Main. Repository MCP SDK/helper required; SVG review needs repository Playwright and milestone 03 Inter data. IDs, raw SVGs, PNGs, checks and saved-version evidence are bundled. This is a reconstruction backup, not a native .penpot export/reimport. SHA256SUMS and extracted archive hashes verified.
