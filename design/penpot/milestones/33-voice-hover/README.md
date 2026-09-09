# Milestone 33 — Voice & Video hover

Three editable static references cover the distinct selector, range and button hover styles. The microphone selector border increases to white at 18% opacity. Native slider paint darkens to #3D47E0, with #E5E5E5 unfilled track and captured border colors. The Mic Test surface becomes #7B7B7B. The checked custom checkbox capture is pixel-identical on hover, so its existing state represents that appearance.

Local Chromium control captures use source CSS. Computed styles alone missed native slider/button hover paint changes; pixel comparison captures them. The hovered 220px slider has an 8px painted track, measured away from its thumb. This reference refines the earlier manual slider geometry; default/range-limit references still require full runtime fidelity comparison. Control captures use the local font fallback; their purpose here is paint comparison, while Penpot retains Inter.

All three native SVG/PNG views were visually reviewed. Native fills, border opacity, slider dimensions, absence of focus outlines and no-interaction checks pass; file validation has no issues. Dimension checks allow 0.001px numerical rounding because Penpot returned 7.999999999999943 for the 8px track. Named save and independent confirmation are included. No prototype or production code changes.

Reconstruction: restore included milestone 27, execute author-voice-hover.js on Desktop — Main, run check-voice-hover.js and inspect exports. Repository MCP SDK, Playwright, Pillow for pixel comparison and milestone 03 Inter support the helpers. The archive contains prerequisites, scripts, local captures, pixel comparisons, native SVG/PNG, IDs, checks and save evidence. It is a reconstruction backup, not a native .penpot export or verified reimport.

Alternate values, minimum-window layouts, full runtime/header/font fidelity, cross-platform native paint and broader desktop design coverage remain open.
