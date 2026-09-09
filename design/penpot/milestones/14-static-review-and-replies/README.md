# Milestone 14 — static visual review and reply excerpts

Established a reliable local review path: read actual Penpot generateMarkup SVG through MCP, render in Chromium with embedded Inter fonts and installed Noto Color Emoji. This bypasses hosted PNG timeouts without reconstructing layouts from our authoring recipe. It is a visual review method, not a new interactive prototype or native .penpot export.

Collected and visually inspected all 17 existing static message/attachment SVGs, including the pending-file and mention designs whose hosted renders timed out. Source-to-runtime geometry comparison remains separate; render inspection only establishes actual native appearance, visibility and layout. Reviewed SVGs, full-size PNGs and contact sheets are included. The collector supports an optional board-name substring to avoid repeating unaffected captures.

Added two static source-defined reply excerpts: normal quoted text and Message deleted for a deleted original. Native text/expected labels/no-interaction checks pass; the actual SVG renders were inspected. Existing six message-action/composer checks also pass; their verifier now selects its owned states explicitly so adding reply variants does not incorrectly change that check's scope.

Saved version Desktop design — milestone 14 static review and replies, revision 36; independently confirmed. Reconstruction backup includes prerequisite milestone 07 and additive author-reply-excerpts.js. For the reviewed prior states, use their original milestone archives; the SVGs here also preserve visual evidence. SHA256SUMS covers all files recursively. No prototype wiring was added.

The static design goal remains incomplete. Runtime geometry differences, synthetic fixture consistency, further control states, media/attachment viewer controls, settings and other desktop families remain tracked. This pass resolves pending native render inspections, not all source-fidelity requirements or whole-screen coverage.
