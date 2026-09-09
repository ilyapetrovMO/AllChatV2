# Milestone 50 — Empty-data Safety moderation

Eight editable static references cover moderator Safety with zero reports and zero moderation records at 1280×800 and 960×640: top, middle, bottom and expanded-empty records at each size. Source records=[] remains truthy, so the moderation form and Purge Old Records stay present. No empty-list copy is rendered by the source.

Source-derived fixtures measured locally establish content height 1321.515625px at both sizes. Maximum scroll is 706px wide and 866px small; middle views use 420px. Expanding empty records changes only the disclosure arrow, with no height change. Native references reuse rendered source-matching labels and controls, remove sample reports, and reposition the remaining fields.

All eight native SVG/PNG exports visually reviewed. Checks cover content/window dimensions, stale-report removal, collapsed/expanded disclosure, text rendering/overflow, thirteen visible controls at each size, file validation and no interactions. Named save independently confirmed.

Reconstruction: restore included milestones 41 and 46 and their prerequisites. Run author-safety-empty-moderator.js until remaining is zero (two batches), then finish-safety-empty-moderator.js until remaining is zero (six batches). Run check-safety-empty-moderator.js and inspect exports. Measurement/render helpers require repository MCP/Playwright and milestone 03 fonts.

This reconstruction backup is not a native .penpot export or verified reimport. Empty/long Member fixtures, other input edge cases, exact native-control/header/platform typography and broader desktop coverage remain unfinished. Unsupported Resolve/Purge prompts remain recorded in issue08. No prototypes, production edits or live actions.
