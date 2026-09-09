# Milestone 66 — Avatar decode failure

Two editable static references at 1280×800 and 960×640 show local Chromium's broken-avatar rendering after malformed image data is assigned. The image is complete with naturalWidth 0. Clipped Community/avatar alt text appears on the rounded 64px purple background; no initial fallback is restored. Remove avatar stays available and General form height remains unchanged.

Source-derived local fixtures capture the image failure without live asset requests. Canvas-template matching establishes text placement; native baseline alignment was corrected by 1.2px after export comparison. The full alt copy remains editable in a native clipping board. Existing lower form references remain applicable.

Native exports visually reviewed. Checks cover decode evidence, image geometry, text copy/position/clipping, removal control, absent initial, unchanged form height, no interactions and file validation. Named save independently confirmed in confirmed-version.json.

Reconstruction: restore included milestones 54 and 60 and prerequisites. Run author-avatar-decode-error.js until remaining 0, then finish-avatar-decode-error.js. Run align-avatar-decode-baseline.js if restoring an earlier authoring result, check and inspect both exports. Helpers require repository MCP/Playwright dependencies and milestone 03 Inter fonts.

Reconstruction backup, not native .penpot export or verified reimport. Fixtures are not live upload/asset-request tests. Other platform broken-image rendering, native file pickers, long filenames, contextual headers/search and broader desktop coverage remain open. No prototype interactions or production edits.
