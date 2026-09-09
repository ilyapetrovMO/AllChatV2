# Milestone 32 — Voice & Video keyboard focus

Four editable static references cover the shared focus styles for selectors, ranges, checkboxes and buttons. Representative controls are Microphone, Microphone volume, Noise gate and Mic Test. These are visual states only; no navigation, interactions or production code changes were added.

Source CSS measured in local Chromium confirms a 3px cyan outline with a 2px offset for all four types. Selectors also receive the brand border and a 2px translucent glow. The measured slider is 220×16 and the checkbox 20×20. Buttons and ranges have square corners; the focused Mic Test button uses the measured zero radius. Shared selector/checkbox rounded outlines follow the corresponding control shape.

All four final native SVG/PNG views were visually inspected. Outline dimensions, placement, visible bounds, stroke styles, selector focus styles and no-interaction checks pass; file validation reports no issues. Named save and independent confirmation are included.

Reconstruction: restore included milestone 27, execute author-voice-focus.js on Desktop — Main, run check-voice-focus.js and inspect native exports. Repository MCP SDK, Playwright and milestone 03 embedded Inter support the helpers. The measurement DOM isolates source control styles; it does not establish full runtime layout or typography fidelity.

This reconstruction backup includes prerequisites, scripts, measurements, native SVG/PNG, IDs, checks and save evidence. It is not a native .penpot export or verified reimport. Alternate values, hover, minimum-window clipping, full runtime/header/font comparison and broader desktop coverage remain open.
