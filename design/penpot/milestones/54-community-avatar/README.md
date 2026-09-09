# Milestone 54 — Community avatar

Four editable 1280×800 static references cover a loaded avatar, initial-load fallback while an avatar URL exists, completed upload with avatar.png selected, and successful removal with filename retained. No-avatar initial is already covered by milestone52. All variants preserve its content height1134.734375 and lower form geometry; existing middle/bottom views apply.

Source-derived local standards-mode Chromium fixtures establish the image, file input and Remove avatar control. The illustrative 64px image is synthetic SVG artwork reconstructed as editable native shapes: blue background, white circle, orange stripe. No real image or screenshot was uploaded. File payload is a synthetic fixture; no live upload/removal action occurred.

Native exports visually reviewed; text positions, initial/image visibility, Remove avatar presence/visibility, selected filename, dimensions, no interactions and file validation checked. Named save independently confirmed; see confirmed-version.json.

Reconstruction: restore included milestone52 and prerequisites. Run author-community-avatar.js four times, then finish-community-avatar.js. Run repair-community-avatar-text.js followed by place-community-avatar-text.js to remount the five new labels, then check-community-avatar.js. Export and inspect the four boards. Helpers require repository MCP/Playwright and milestone03 embedded Inter fonts.

This is a reconstruction backup, not a native .penpot export or verified reimport. Native bevels, file selector details and platform fonts remain approximations. Initial-load fallback is distinct from decode failure after a blob URL exists; source has no onError handler. Pending replacement can retain the old image. File picker, pending/decode/long-content/minimum-window states and broader desktop coverage remain open. No prototypes or production edits.
