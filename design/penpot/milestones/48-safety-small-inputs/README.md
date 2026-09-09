# Milestone 48 — Minimum-window filled Safety forms

Three editable static 960×640 views show the filled report, Timeout moderation and account-deletion forms. Eight entered fields reuse verified native text from wider references: selected Morgan, reasons, Timeout, 30-minute duration, twelve password mask dots and exact DELETE confirmation. Values are synthetic; no live action was sent.

Local source-derived Chromium captures confirm the 584px form controls and 554px deletion inputs. Report scroll is zero, moderation scroll is 640px and deletion scroll is 301px. Native field labels were placed from these measured bounds; default selected values were removed.

All three final native SVG/PNG exports visually reviewed against captures. Checks cover minimum dimensions, entered copy, stale selections, field containment, visibility, zero interactions and file validation. Named save independently confirmed.

Reconstruction: restore included milestones 43 and 46 and their prerequisites, run author-safety-small-inputs.js until remaining is zero (three batches), run check-safety-small-inputs.js and inspect exports. Measurement/rendering helpers use repository MCP/Playwright and milestone 03 fonts. Only mask dots, not the synthetic password string, are authored into Penpot.

This reconstruction backup is not a native .penpot export or verified reimport. Minimum-window validation, long/empty fixtures and other input edge cases, exact native-control/header/platform typography and broader desktop coverage remain unfinished. No prototypes or production changes.
