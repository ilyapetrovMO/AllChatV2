# Milestone 15 — account and Sessions static designs

Five native boards on Desktop — Main: My Account initial and scrolled views, plus Sessions loading, empty and populated. Account covers avatar/banner file inputs and removal controls, username/display-name fields, Save Profile and presence buttons. Every view includes the member-settings navigation. Sessions shows Revoke only for the non-current session; the empty state deliberately has no invented placeholder copy.

Source: desktop/src/renderer/app.tsx account branch around 1405, Sessions around 1472, ProfileImages around 3672; desktop renderer stylesheet for settings/profile/session rules. Geometry is source-informed and manually laid out; exact runtime comparison remains pending. Fixtures are synthetic. Inter remains the current typography assumption.

All five actual SVG renders were visually inspected. Fixed native fieldset clipping so legends remain visible. The SVG review renderer now removes duplicated top-level descendant groups emitted by generateMarkup, retaining the selected native board hierarchy and all its clipping, and uses that board’s native bounds. Raw exported SVG files remain untouched. Earlier review images need renewed inspection with this correction, especially overlapping and clipped content; the coverage ledger records that limitation.

Native checks pass: expected navigation and account labels, loading copy, exactly one eligible Revoke control, text bounds, zero prototype links and no file validation issues. Named version “Desktop design — milestone 15 account and sessions” independently found at revision 40. No new prototype wiring.

Reconstruction: restore the included milestone 07 base, then run author-account-sessions.js on Desktop — Main through the existing MCP runner. The author is idempotent for complete boards. Scripts depend on the repository MCP SDK; the review renderer also uses repository Playwright and milestone 03’s embedded Inter fonts. This bundle is reconstruction evidence, not a successful native .penpot export/reimport. Save/confirm JSON, IDs, raw SVGs, PNGs and review sheets are included.

Still required: image crop dialogs, file-picker references, upload/status and validation states, session-revocation confirmation, applicable focus/hover/error states and runtime geometry review. Other settings and desktop families remain incomplete. SHA256SUMS covers the bundle; archive extraction and hashes are checked separately.
