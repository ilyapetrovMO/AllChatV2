# Milestone 65 — Pending avatar fallback

Two editable static references at 1280×800 and 960×640 show the Community initial, selected avatar.png filename and Remove avatar control. This combination occurs after an upload resolves with a URL while the first asset request is pending; it also represents a selected upload while an existing URL still renders the initial fallback.

Source-derived local Chromium fixtures establish file/button geometry and unchanged General content height (1134.734375/1179.515625). The minimum-width removal label wraps onto two lines. Existing lower form references remain applicable. General asynchronous state notes map visually identical pending and failed upload/removal states to existing image/removed designs.

Native exports visually reviewed. Checks cover initial/filename, file and removal-button geometry, label wrapping/fit, content height, text positions, no interactions and file validation. Named save independently confirmed in confirmed-version.json.

Reconstruction: restore included milestones 54 and 60 with their prerequisites. Run author-avatar-pending-fallback.js until remaining 0, then finish-avatar-pending-fallback.js. Reapply alignment after native layout settles if needed. Run checks and inspect both exports. Helpers require repository MCP/Playwright dependencies and milestone 03 Inter fonts.

Reconstruction backup, not native .penpot export or verified reimport. Local fixtures do not execute live upload/asset requests. Native image decode failure, filename extremes, file pickers, contextual headers/search and platform fidelity remain open. No prototype interactions or production changes.
