# Voice Rooms recovery sources

Preserved from the September 9 design session before rebuilding the Penpot page.

- `connected`, `muted`, `focus`, `compact`, and `empty` JSON/PNG files capture the desktop app. The menu and soundboard captures describe separate overlays.
- `*-vectors.json` contains outlined text for rebuilding native vector artwork when Penpot text rendering fails.
- `focus-verified.svg` and `.png` preserve the corrected focus composition.
- `grid-review.svg` and `.png` preserve the two-column, centered-last-row iteration. The final avatar corner-radius adjustment to 70 px happened after this export.
- Other SVG/PNG files are intermediate rendering diagnostics and may show known defects.

These files are recovery material, not a complete native Penpot file backup. Prototype interactions need to be recreated.
