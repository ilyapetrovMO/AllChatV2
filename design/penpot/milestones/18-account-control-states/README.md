# Milestone 18 — account form control states

Four static native account views: username hover, username keyboard focus, Save Profile keyboard focus, and empty required username with a native Chromium validation-popup reference. Local Chromium measured the actual renderer stylesheet and reported valueMissing=true with “Please fill out this field.” A delayed screenshot captured the native popup; editable shapes/text reproduce it without uploading a screenshot.

Measured hover border is white at 14% opacity. Keyboard focus is a 3px cyan outline offset 2px; focused inputs also have a 2px purple glow at 24% opacity. The later profile-form CSS overrides the input border to transparent, so no invented purple border was added. Existing account geometry remains a manual reference pending full runtime comparison.

All four native renders visually inspected. Checks cover required message/empty value, focus outlines, hover border, no interactions and file validation. Saved and independently confirmed; see confirmed-version.json. The measurement script creates a disposable local DOM with the source form and CSS solely to inspect controls; no user-facing prototype or application change was added.

Reconstruction: prerequisite milestone 16, then author-account-controls.js on Desktop — Main. Repository MCP helper/SDK and Playwright are required for the provided scripts. Native markup rendering uses the earlier milestone 03 Inter font data. The original CSS screenshots, computed styles, native SVG/PNG review, IDs and checks are included. Native-popup typography and styling can vary by platform; this reference uses Chromium on Linux and the design’s Inter convention. This is a reconstruction backup, not a native .penpot export/reimport.

Remaining: other account control variants, full runtime geometry review, OS-native file picker and session confirmation, other settings, and remaining desktop families. Full design coverage is not complete.
