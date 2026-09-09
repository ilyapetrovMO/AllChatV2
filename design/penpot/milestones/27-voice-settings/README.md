# Milestone 27 — Voice & Video default settings

Four editable static views cover the default form: Voice, Input processing, Camera, Screen sharing, and Advanced. All selectors, ranges, checkboxes, test/reset buttons and the camera-off preview are represented. Source defaults are recorded in voice-settings-state-audit.md. No new prototype interactions or production code changes.

All four final native SVG renders were visually reviewed. The sensitivity output visibly reads -50 dB on one line. Native labels/default checks pass and the file reports no validation issues. Named milestone 27 was saved and independently confirmed at revision 56. The earlier checks at revision 55 precede the named save.

## Reconstruction

Restore the included milestone 16 prerequisites onto Desktop — Main. Run author-voice-settings.js once to construct the default view, then refine-voice-text.js and settle-voice-text.js. Execute refresh-away.js and refresh-back.js in separate MCP requests to remount the canvas and settle rendered text. Re-export and inspect the default view before running author-voice-settings.js again to create the three scroll views. Refresh away/back again, run check-voice-settings.js, and inspect exports of all four views. Page IDs in the refresh scripts refer to this file and must be resolved by page name in a reconstructed file. SDK/Playwright dependencies and milestone 03 embedded Inter support the repository export/render helpers.

The backup includes native SVG/PNG artifacts, board identifiers, reconstruction scripts, source references, checks and save evidence. This is a reconstruction backup, not a native .penpot export or verified reimport.

## Rendering investigation and limitations

Penpot retained stale glyph layout after text edits: metadata said -50 dB while the canvas export showed 100%. Fresh text also exported blank. Switching to Desktop — Login and back to Desktop — Main repaired text layout; final renders are in frames/. diagnostics/ preserves earlier evidence with obsolete IDs or incorrect text and must not be used as the final design. The temporary label board was removed before the named save. The reconstruction recipe uses canvas remounting instead of the unsuccessful text replacement attempts.

Geometry includes manual source-informed approximations and an inherited settings header. Exact runtime/header comparison and Linux fallback typography remain open. Device menus, alternate values, notices, camera-on, focus/hover, minimum-window and broader desktop design coverage remain incomplete, as recorded in the coverage ledger and state audit.
