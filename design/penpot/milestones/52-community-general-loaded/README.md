# Milestone 52 — Community General loaded

Six editable 1280×800 static boards cover default General and expanded relay identity, each with top/middle/bottom scroll references. Default state shows initial avatar, generated ringtone, two file inputs, Community name, maximum attachment size, Guide, empty push relay, collapsed relay identity and Save settings. Expanded identity includes synthetic key ID and read-only public key. Source values are illustrative, not backend defaults.

Local standards-mode Chromium fixtures derive from CommunityAdministration JSX and stylesheet. Content origin (344,116), width904. Default height1134.734375, expanded1280.6875; maximum scroll531/677. Middle scroll500. Native exports reviewed, text positions and full visibility across scroll views checked, no interactions, file validation clean. Save independently confirmed; see confirmed-version.json.

Reconstruction: restore included milestone51 and prerequisites. Run author-community-general-loaded.js repeatedly until remaining:0, then finish-community-general-loaded.js and check-community-general-loaded.js. Export and inspect all six boards. Scripts require repository MCP/Playwright and milestone03 Inter fonts. File selector geometry and native bevels use editable approximations. Code key ID currently uses Inter instead of platform monospace; platform font fidelity remains open.

This is a reconstruction backup, not a native .penpot export or verified reimport. Captures are local source fixtures, not authenticated app screenshots. Present-avatar/custom-ringtone/upload/removal/notices, save failures, validation, minimum window, long content, search/contextual headers and other administration sections remain open. No prototypes or production edits.
