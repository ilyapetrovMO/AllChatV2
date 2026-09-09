# Milestone 42 — Safety dropdown menus

Three editable static 1280×800 views show Report a Member (Choose a Member, Alex, Morgan), moderation Action (Warn, Timeout, Suspend, Kick), and moderation Member (Alex, Morgan). These nine rows reproduce the source options and synthetic Member fixtures.

Local source-derived Chromium captures confirm 800px menus aligned with the right edge of 896px controls, opening below each control. Option rows are 24px high. Source computed focus/hover styling is captured: cyan 3px outline with 2px offset, 14% white border, and 24% brand-colored 2px shadow. Selected first rows and menu borders are preserved.

Native SVG/PNG views visually inspected against captures. Checks cover menu placement, option copy/rendering, viewport containment and zero interactions; file validation passes. A transient blank-text report during finishing was resolved by an independent rendering check and idempotent finish. Final actual exports contain every option. Named save independently confirmed.

Reconstruction: restore included milestone 41 and its prerequisites, run author-safety-menus.js until remaining is zero (three batches), export initial SVG to settle text, then run finish-safety-menus.js, check-safety-menus.js, and inspect final exports. Repository MCP/Playwright helpers and milestone 03 fonts are prerequisites. No live reports or moderation actions were sent.

This reconstruction backup is not a native .penpot export or verified reimport. Selected/input variants, validation, native dialogs, minimum-window menus, long/empty Member fixtures, full runtime/header/platform typography and broader desktop design coverage remain unfinished. No prototypes or production changes.
