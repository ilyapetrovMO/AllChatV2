# Milestone 17 — cancelled profile crops

Two static native views show Cancel after selecting an avatar or banner: editor closed, original profile image unchanged, selected filename and ready-to-upload status retained. Based on ProfileImages cancel handler in app.tsx:3731. Both native checks and actual SVG render review pass. Named Penpot save independently confirmed at revision 44.

The included profile-state-audit.md also traces upload/decode rejection and profile-save errors. Those paths have no implemented profile error notice, so no error copy was invented. Native file-picker, required-field validation and session confirmation references remain open, together with control-state and geometry reviews.

Reconstruction: restore prerequisite milestone 16, then run author-crop-cancelled.js on Desktop — Main through the repository MCP helper. No prototype interactions. Raw SVGs, PNGs, source audit, identifiers, checks and version evidence are included. This is a reconstruction bundle, not a native .penpot export/reimport. SHA256SUMS covers all bundled files; extraction and hashes verified.
