# Milestone 62 — Minimum-window General validation

Seven editable 960×640 static references cover empty Community name, required attachment size, minimum 1, maximum 256, integer step, nonnumeric input, and URL validation.

Local source-derived Chromium fixtures show automatic scroll 567 for name, 641 for attachment fields, and 736 for relay URL. Focus rings clip at the content viewport. The step message wraps onto two lines in a 479×57 bubble. Other messages use 41px-high bubbles. The raw nonnumeric entry “e” remains visible while the number input DOM value is empty.

Native exports visually reviewed. Checks cover exact messages and values, focused field and popup geometry, text rendering/fit, number spinners, viewport clipping, no interactions, and file validation. See confirmed-version.json for the independently verified named save.

Reconstruction: restore the included milestone 58 with its prerequisites, run author-general-minimum-validation.js until remaining 0, then finish-general-minimum-validation.js. Reapply alignment after native layout settles if needed; run checks and inspect all exports. Helpers use the repository MCP/Playwright dependencies and milestone 03 embedded Inter fonts.

This is a reconstruction backup, not a native .penpot export or verified reimport. Native platform fonts and bevels remain approximate. Fixtures do not test the live backend. Narrow valid-input boundaries, pending/file-picker states and broader desktop coverage remain open. No prototype interactions or production changes.
