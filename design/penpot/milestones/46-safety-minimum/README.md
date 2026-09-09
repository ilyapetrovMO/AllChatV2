# Milestone 46 — Minimum-window Safety layouts

Ten editable static 960×640 references cover Member top/bottom, loading, Member reports top/bottom, moderator top/middle/bottom and expanded records middle/bottom. Source-derived fixtures measured in Chromium confirm 584px content width. The chosen samples retain the same content heights as the wide form, while maximum scroll increases by 160px.

Member maximum scroll is 301px, reports 445px, moderator 1052px and expanded records 1124px. Middle views use scroll 640px. Native shell geometry, content/control widths, selector arrows and textarea resize marks were adapted to the minimum window. Existing rendered text is reused and positioned from measured bounds.

All ten native SVG/PNG views visually reviewed. Checks cover window/content dimensions, text rendering and overflow, fourteen controls visible across references, zero interactions and Penpot validation. Named save independently confirmed.

Reconstruction: restore included milestone 41 and its prerequisites, run author-safety-minimum.js until remaining is zero (five bounded batches), then finish-safety-minimum.js until remaining is zero (five bounded batches). Run check-safety-minimum.js and inspect final exports. Measurements use included fixtures, repository CSS, Playwright and milestone 03 fonts. Existing SDK/renderer helpers support native exports.

This reconstruction backup is not a native .penpot export or verified reimport. Minimum-window menus, validation/input variants, long/empty fixtures, exact native-control/header/font fidelity and broader desktop coverage remain unfinished. The unsupported native-prompt finding remains recorded in issue08; no production fix, prototype or live action was performed.
