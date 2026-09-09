# Milestone 31 — Voice processing preferences

Five editable static references: echo cancellation off, automatic gain control on, noise gate off, minimum sensitivity -80 dB and maximum sensitivity -20 dB. Other preferences retain defaults. The source does not disable sensitivity when noise gate is off, so that state retains its normal slider. No prototype wiring or production code changes.

All five views were visually inspected. Checks cover checkbox ticks/fills, sensitivity text, slider fill/thumb positions, visibility and no interactions, with no file validation issues. The text check also reads generated native SVG: stored characters alone previously passed while exports incorrectly showed -50 dB. The final min/max exports show the correct -80 dB / -20 dB labels. Named save and independent confirmation are included.

## Reconstruction

Restore included milestone 27. Run author-voice-processing.js until remaining is zero (two bounded batches), then refresh-away.js and refresh-back.js in separate MCP calls. For fresh limit labels, run stage-threshold-text.js, size-threshold-text.js and position-threshold-text.js, refresh away/back and verify the reference export. position-threshold-text.js moves the helper near the origin, brings it forward and sets explicit auto-height dimensions; earlier sizing-only attempts exported blank. Once both reference labels render, run place-threshold-text.js, which installs them and removes the helper. Run finish-voice-processing.js, check-voice-processing.js and inspect all five final exports. Resolve page IDs by name in a reconstructed file. Repository MCP SDK/Playwright and milestone 03 Inter support the helper scripts.

The backup contains prerequisites, scripts, final native SVG/PNG, verified text reference, IDs, checks and save evidence. It is a reconstruction backup, not a native .penpot export or verified reimport. Inherited manual geometry/header/font assumptions remain, along with alternate selections, microphone/speaker ranges, focus/hover, minimum-window and broader desktop coverage.
