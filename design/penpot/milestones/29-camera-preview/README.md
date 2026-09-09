# Milestone 29 — Camera preview on

Three editable static references: landscape video, portrait video, and the scrolled Camera preview started notice. Stop Video replaces Test Video and the off placeholder is absent. Native vector color bars represent arbitrary synthetic camera content; they are not product UI. No camera device was accessed and no prototype interactions were added.

A local browser measured the actual source camera CSS with canvas-generated streams: the 854px-wide video element and preview reach 320px height; object-fit contain centers a 568.89×320 landscape frame or 180×320 portrait frame. The design expands the Camera card and shifts subsequent sections by 140px. The notice remains below Advanced. Measurements and script are included.

All three final native SVG renders were visually reviewed. Preview dimensions/centering, camera-on copy, absence of off controls, Stop Video centering, relevant visibility and no-interaction checks pass; file validation has no issues. Named save and independent confirmation are recorded separately.

## Reconstruction

Restore included milestone 27, then run author-camera-preview.js on Desktop — Main. Create the two-label reference with stage-camera-text.js, size it with size-camera-text.js, and run origin-camera-text.js to put it near the canvas origin with explicit auto-height sizing. Execute refresh-away.js and refresh-back.js in separate MCP requests. Export the reference and confirm visible glyphs before running place-camera-text.js; it copies the verified labels, centers Stop Video and removes the helper. Run check-camera-preview.js and inspect final exports. Resolve page IDs by name in a reconstructed file. The repository MCP SDK, Playwright and milestone 03 embedded Inter support the helper scripts.

Native text exported blank during initial attempts. Auto-width and page switching alone did not reliably resolve this checkpoint; the reference finally rendered after moving near the canvas origin and applying auto-height dimensions. text-reference/ preserves that successful render. These steps are a reconstruction recipe, not a proven native reimport.

This backup contains prerequisites, editable author scripts, native SVG/PNG, IDs, source measurements, checks and save evidence. It is not a native .penpot export. Full runtime/header/font fidelity, minimum-window variants, expanded menus, alternate preferences and broader desktop coverage remain open.
