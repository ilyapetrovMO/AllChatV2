# Milestone 05 — minimum-window native references

Three editable Penpot reference boards now show the initial Sign in, Register and Recovery layouts at the desktop minimum 960 × 640. Their geometry comes from the milestone 04 browser audit, with 480px-wide authentication cards. Sign in and Register PNGs were visually reviewed; all three boards passed text-bounds and geometry checks and Penpot validation returned no issues. Recovery was checked structurally, not by rendered-image inspection in this checkpoint.

These are static layout references, excluded from the prototype viewer. The existing milestone 03 navigable flow remains the interactive Penpot entry; the milestone 04 browser artifact provides true typing and scrolling at both supported window presets. Register has 636px content in a 612px content viewport, so its initial viewport clips the bottom card padding and the browser can scroll it.

Saved version: Desktop login — milestone 05 minimum window, revision 16. A separate version-history call confirmed it. See saved-version.json and confirmed-version.json. This is not a reopened-file verification.

This reconstruction backup includes the prerequisite milestone 03 archive and the additive author-login-minimum.js recipe. Reconstruct milestone 03 first, then execute this recipe on Desktop — Login. The file guard protects against the wrong destination. Native .penpot export/reimport, token propagation and exact platform typography remain open; full login completion and the broader main desktop design are not claimed.
