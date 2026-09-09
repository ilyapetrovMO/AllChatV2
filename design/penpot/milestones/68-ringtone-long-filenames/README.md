# Milestone 68 — Long ringtone filenames

Two editable static references at 1280×800 and 960×640 show a long selected ringtone filename while generated audio remains active. Local 2× Chromium captures establish the visible middle truncation for 862px and 542px inputs. Exact visible strings and the full synthetic filename are recorded in measurements.json; the full name is also attached to native text as plugin metadata.

The editable filename uses an input-content clipping board, 759/439px wide. Penpot text advance differs by about 1px for the small case; source input clipping is preserved, with platform typography still approximate.

File selection leaves the ringtone card and lower form layout unchanged. Existing scroll references remain applicable. The filename rendering also applies to the custom-audio card, whose file input has the same width. State notices and removal controls remain covered separately.

Native exports visually reviewed. Checks cover displayed/full filename, input geometry, text fit/positions, generated audio, removal-control absence, unchanged content height, no interactions and file validation. Named save independently confirmed in confirmed-version.json.

Reconstruction: restore included milestone 64 with prerequisites. Run author-ringtone-long-filenames.js until remaining 0, then finish-ringtone-long-filenames.js; repeat alignment after native layout settles if needed. Run clip-ringtone-filenames.js to constrain the filename inside its input area, then run checks and inspect both exports. Helpers use repository MCP/Playwright dependencies and milestone 03 Inter fonts.

Reconstruction backup, not native .penpot export or verified reimport. Fixtures do not upload audio or execute live requests. Native file-picker surfaces, contextual headers/search, other platform typography and broader desktop coverage remain open. No prototype interactions or production edits.
