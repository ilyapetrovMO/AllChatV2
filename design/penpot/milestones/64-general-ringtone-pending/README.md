# Milestone 64 — Pending Community ringtone

Four editable static references cover pending first upload with generated audio and pending replacement with custom audio at 1280×800 and 960×640. The selected filename is visible, the previous audio remains active, and the notice is empty. The custom state retains its removal control. No spinner or disabled appearance is invented.

Source-derived local Chromium fixtures select synthetic ringtone.ogg without backend submission. Card heights remain 248.5px (generated) and 288.890625px (custom); widths are 904/584px. Existing lower form scroll references from milestones 52/53/58/61 remain applicable.

The source-derived general-async-state-map.md maps repeated uploads and pending/failed removals to existing visuals. It also records unrepresented avatar/picker/filename cases. Native exports visually reviewed; checks cover filename, active audio, absent notice, removal control, card geometry, unchanged content height, text positions, no interactions and file validation. Named save independently confirmed in confirmed-version.json.

Reconstruction: restore the included milestones and prerequisites, run author-general-ringtone-pending.js until remaining 0, then finish-general-ringtone-pending.js. Reapply alignment after layout settles if needed; run checks and inspect exports. Helpers require repository MCP/Playwright dependencies and milestone 03 Inter fonts.

Reconstruction backup, not native .penpot export or verified reimport. Fixtures are not live asynchronous React/backend tests. Native typography/bevels, avatar pending/decode states, file-picker surfaces, long filenames, contextual headers/search and broader desktop coverage remain open. No prototype interactions or production edits.
