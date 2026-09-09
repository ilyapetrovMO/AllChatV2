# Milestone 61 — Minimum-window Community ringtone

Fifteen editable 960×640 static references cover custom audio, saved upload, failed upload with generated audio, failed upload with existing custom audio, and successful removal. Each has top/middle/bottom views. Source filenames and notices follow milestone 53; narrow form wrapping follows milestone 58. All controls are visible across each set of scroll references.

Local standards-mode Chromium fixtures establish heights/max scroll: custom 1219.90625/776; saved and custom-error 1242.296875/798; generated-error/reset 1201.90625/758. Middle scroll 500. Card text stays single-line. Native mature card content is resized/recentered and the existing narrow form shifts with the measured height.

Native exports visually reviewed. Checks cover exact active audio/notices/filenames, text positions, full control visibility across views, no interactions and file validation. Named save independently confirmed; see confirmed-version.json.

Reconstruction: restore included milestones 58 and 53 with prerequisites. Run author-ringtone-minimum.js until remaining 0, then finish-ringtone-minimum.js until remaining 0 and again for the manifest. Run check-ringtone-minimum.js and inspect all fifteen boards. Helpers require repository MCP/Playwright and milestone 03 embedded Inter fonts.

Reconstruction backup, not native .penpot export or verified reimport. Native platform fonts/bevels, pending/repeated-upload/file-picker edges, narrow validation/input variants and broader desktop coverage remain open. Captures are local fixtures; no live audio upload or backend action. No prototypes or production edits.
