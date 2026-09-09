# Milestone 16 — profile crops and upload success

Added six static native views: avatar and banner crop dialogs at zoom 1 and 3, plus avatar/banner updated states. Each crop includes heading, clipped synthetic image, Zoom range, Upload and Cancel. No invented backdrop or close control. The selected synthetic filename persists in the file input and source-defined ready/success status copy is represented.

Source: ProfileImages in desktop/src/renderer/app.tsx around 3672 and crop CSS at styles.css:538–545. Dialog dimensions are based on local Chromium measurements using the renderer stylesheet (measurement fixture/evidence included). The design retains Inter; the measurement fixture uses system fallback, so this is not proof of exact typography or platform-native button fidelity. The neutral crop action buttons reflect the existing browser-default styling. Synthetic landscape shapes are editable fixtures, not uploaded member data.

Corrected earlier account styles against CSS: purple file-selector controls, muted regular-weight removal labels, and sidebar-coloured image panel without shadow. Native text property mutations initially reported success while SVG markup retained old content; recreating the affected text layers resolved the discrepancy. Final visual review uses actual native board hierarchy with the milestone 15 SVG-export correction.

All six crop/status variants pass expected labels, selected filename, clipping and no-interaction checks. All eleven settings renders were reviewed, including the amended account views. Saved and independently confirmed the reviewed milestone version; see confirmed-version.json for its revision. No new prototypes or interaction wiring.

Reconstruction order: included milestone 15 base, author-profile-crops.js, fix-profile-control-styles.js, refresh-profile-labels.js. Existing repository MCP runner/SDK is required; local review uses repository Playwright and milestone 03 Inter font data. Raw SVGs, review PNGs, identifiers, checks and saved-version evidence are included. This is a reconstruction bundle, not a native .penpot export/reimport.

Still missing: cancelled-crop retained status, image-error cases, native file picker, username validation, focus/hover and minimum-window variants, session-revocation confirmation, and other settings/families. Prior message/attachment renders also require renewed inspection with the corrected SVG renderer. The full static design objective remains active.
