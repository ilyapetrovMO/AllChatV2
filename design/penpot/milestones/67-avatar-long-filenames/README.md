# Milestone 67 — Long avatar filenames

Four editable static references cover long avatar filenames at 1280×800 and 960×640, both with and without an avatar URL/removal control. The synthetic selected name is community-avatar-summer-event-2026-high-resolution.png. The 306px input shows community-av…-resolution.png; the 213.25px narrow input with removal shows commu…ion.png.

Source-derived local Chromium fixtures and 3× detail captures establish the visible text. Canvas candidate matching confirms the narrow text exactly; its wide-input result was inconclusive and is retained as diagnostic evidence, not used as the accepted copy. The full filename remains attached to the native text as plugin metadata. Layout and lower form references remain unchanged.

Native exports visually reviewed. Checks cover exact visible/full filename, input geometry, text fit/positions, removal-control state, unchanged content height, no interactions and file validation. Named save independently confirmed in confirmed-version.json.

Reconstruction: restore included milestones 54 and 60 with prerequisites. Run author-avatar-long-filenames.js until remaining 0, then finish-avatar-long-filenames.js; repeat alignment after native layout settles if needed. Run checks and inspect all four exports. Helpers use repository MCP/Playwright dependencies and milestone 03 Inter fonts. The detail measurement script writes temporary captures to /tmp/allchat-largefile.

Reconstruction backup, not native .penpot export or verified reimport. Fixtures do not submit uploads. Native file-picker surfaces, ringtone long filenames, other platform typography and broader desktop coverage remain open. No prototype interactions or production edits.
