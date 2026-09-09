# Milestone 28 — Voice & Video feedback

Nine editable static feedback views cover unavailable media devices; working microphone; working RNNoise microphone; RNNoise compatibility fallback; microphone permission/device failure; stopped camera; camera permission/device failure; speaker test; and reset preferences. Camera is off in these fixtures. Enhanced success and fallback retain the enhanced suppression preference. No prototype links or production code changes.

The source places its single status paragraph below Advanced; these designs use the existing scrolled view to reveal it. All nine messages were checked against implementation strings. Final native SVG/PNG views were visually inspected: long error and fallback messages are readable, and no notice is clipped. Structural notice placement, camera-off fixtures, preference values and no-interaction checks pass; file validation has no issues. Save and independent confirmation are recorded in separate JSON files.

## Reconstruction

Restore included milestone 27. On Desktop — Main, execute author-voice-feedback.js repeatedly until remaining is zero (three bounded batches). Execute stage-voice-feedback-text.js, then refresh-away.js and refresh-back.js in separate MCP requests. Re-export the text reference and verify all messages are visible before running place-voice-feedback-text.js. Execute finish-voice-feedback.js to remove the temporary reference and size the changed suppression values, refresh away/back, run check-voice-feedback.js, and review final exports. Resolve refresh page IDs by name in a reconstructed file. Repository MCP SDK/Playwright and milestone 03 Inter are helper dependencies.

Some newly created fixed-size text exported blank despite correct strings. Auto-width native text followed by canvas remount rendered all messages; cloning those verified labels repaired final views. text-reference/ records the verified temporary reference, which was removed from Penpot before saving. The final screens are in frames/.

This is a reconstruction backup with prerequisites, scripts, native SVG/PNG, IDs, checks and save evidence; it is not a native .penpot export or verified reimport. Source-informed manual geometry and inherited header/font assumptions remain. Camera-on/started, menus, alternate preferences, focus/hover, minimum-window and broader desktop coverage remain incomplete. No actual microphone/camera capture was performed for these static fixtures.
