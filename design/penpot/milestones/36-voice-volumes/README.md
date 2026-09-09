# Milestone 36 — Voice volume ranges

Four editable static references: microphone at 0% and 200%, speaker at 0% and 50%. Existing 100% defaults supply microphone midpoint and speaker maximum. Each view changes only one control. No tests/media capture, prototype wiring or production code changes.

All four native SVG/PNG views were visually reviewed. Checks verify actual exported percentage text, thumb/fill fractions, output visibility and separation from the slider, unchanged other volume, and no interactions. File validation has no issues; named save and independent confirmation are included. Source scales are microphone gain 0–2 and speaker volume 0–1, each stepping by 0.05, with rounded percentage output.

Reconstruction: restore included milestone 27, run author-voice-volumes.js and stage-volume-text.js. Export the reference once, then run position-volume-text.js and refresh-away.js / refresh-back.js in separate MCP calls. Export and verify the three fresh percentage labels before place-volume-text.js, which installs them and removes the reference. Run check-voice-volumes.js and inspect final exports. Resolve refresh page IDs by name in a reconstructed file. Repository MCP SDK, Playwright and milestone 03 Inter support the helpers.

This reconstruction backup includes prerequisites, scripts, native SVG/PNG, text reference, IDs, checks and save evidence. It is not a native .penpot export or verified reimport. The range geometry is inherited from the manual default form; exact runtime track/header/font fidelity remains open, along with named/long devices, minimum-window layouts and broader desktop design coverage.
