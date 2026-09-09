# Milestone 63 — Minimum-window General input boundaries

Four editable 960×640 static references cover minimum and maximum valid input fixtures, each at middle (500) and bottom (736) scroll positions. Minimum: name A, attachment size 1 MiB, empty Guide and relay. Maximum: 100-character name after 101 attempted keyboard characters, 256 MiB, filled Guide and valid relay URL.

The full stored name is retained as editable text, clipped inside the input's 528px content width. After blur the source input scrollLeft is zero. Filled relay text uses entered-value styling even when its copy equals the placeholder.

Local source-derived Chromium fixtures pass frontend checkValidity; these are not live backend submission tests. Native exports visually reviewed. Checks cover values, entered-value colour, field geometry, text alignment, clipping, visibility across scroll references, no interactions and file validation. See confirmed-version.json for the independently confirmed save.

Reconstruction: restore included milestone 58 and prerequisites. Run author-general-minimum-boundaries.js until remaining 0; run finish-general-minimum-boundaries.js and realign again after native layout settles. Run checks and inspect all four exports. Helpers require repository MCP/Playwright dependencies and milestone 03 embedded Inter fonts.

Reconstruction backup, not native .penpot export or verified reimport. Native typography/bevels, pending/file-picker states and broader desktop coverage remain open. No prototype interactions or production edits.
