# Milestone 22 — Ringtone keyboard focus and minimum window

Six static references: file-input, reset-button and volume-range keyboard focus; 960×640 generated-tone view; minimum custom-tone initial viewport; minimum custom-tone scrolled viewport. The custom-tone volume control is partly clipped initially and fully visible after scrolling. Window controls, sidebar member panel and add-community control are repositioned for the shorter/narrower frame.

The source stylesheet was measured in local Chromium using embedded Inter and a disposable Ringtone DOM fixture. Keyboard outlines are cyan, 3px with 2px offset. At minimum size, custom content requires scrolling (measured scrollHeight 674 versus clientHeight 564); default content also includes bottom padding beyond its visible controls. Native geometry retains minor manual approximation from the earlier base, so this is not an exact pixel comparison of the running app.

All six actual native SVG renders visually inspected. Checks cover minimum board/viewport size, clipped viewport, scrolled slider bounds, focus outlines and no prototype interactions. Saved/confirmed version recorded separately. The SVG review renderer now sizes PNGs to each native board and preserves aspect ratio in contact sheets. Additional prior raw Ringtone SVGs were collected but not counted as new verification.

Reconstruction: included milestone 20 followed by author-ringtone-controls.js. Repository MCP SDK/helper, Playwright and milestone 03 font data support the scripts. Raw SVGs/PNGs, local CSS measurements/screenshots, IDs, checks and save evidence are bundled. No new user-facing prototype or production code change. This is a reconstruction backup, not a native .penpot export/reimport.

Hover styles, native file picker and complete runtime fidelity remain open. Broader desktop design coverage remains active.
