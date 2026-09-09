# Penpot verification evidence

Status: unresolved. Do not treat imported boards or token bindings as visually verified.

## Minimal export reproduction

On hosted file `c828d3cf-7d4e-8145-8008-9a4f1a6ff37f`, a native board named `Verification — temporary` was created with width/height 100, at (2200,0), containing a 20×20 red rectangle at (2210,10). A subsequent independent execute_code call read back these exact dimensions and color from the current page tree.

Native `board.export({type:'png',scale:1})` failed waiting for `#screenshot-6bdc1c40-ce96-804f-8008-9a5665418794`: the server screenshot locator resolved to a hidden SVG of width/height 0.01. This reproduces an export discrepancy without imported SVG, typography or tokens.

The full trial export repeatedly showed earlier icon coordinates and hidden labels, although fresh API reads reported corrected coordinates and visibility. Reacquiring the board from the current page did not fix export.

A named saveVersion request (`AllChat catalog — component draft`) timed out. Its completion is unknown; do not retry blindly or assume the version was saved.

Ranked hypotheses: export reads stale/unpersisted backend state; plugin returns stale proxy state; hosted export service fails independently of editor state. Cause is not yet established. Live-canvas comparison was requested from the user.

## Token check

Temporary brand-color change was restored in a finally block. Initial test observed 0/8 updated fills after 500ms. It used previously acquired shape handles, so this does not prove token propagation is broken; repeat using fresh handles and verify pixels after export fidelity is resolved.

A later independent live read reported file revision 5 and the probe still at 100×100. No evidence yet confirms backend persistence of the later edits.

## Live rendering comparison

`penpot.currentFile.validate()` on Penpot 2.17.2 returned an empty error list. Both `file.export('penpot','all')` and `file.export('zip','all')` failed with `No matching clause`.

The generated live SVG (`penpot.generateMarkup`) was saved and rendered locally. It shows corrected icons and hidden labels, unlike the hosted screenshot export. This establishes that these edits exist in live geometry, while hosted export remains inconsistent. The local SVG lacks the font resources used by Penpot and renders fallback typography; it is not a typography-fidelity pass. `live-recovery.json` is a recovery aid, not a full native backup (path commands and other properties are not exhaustively serialized).

Official API reference consulted: https://doc.plugins.penpot.app/interfaces/File (validate and export). A related reported limitation is stale same-execution API reads: https://github.com/penpot/penpot/issues/10200; this does not alone explain the multi-call hosted-export mismatch.

## Native component token reproduction

A native primary button and its instance were created on the Shared components page from the measured desktop submit button (384×43.171875, 4px radius, Inter 700 at 16px). Both shapes reported a `brand` fill binding. Changing the token to #FF00FF updated its resolved value, but fresh page-tree reads after 1000ms still reported #6d75e8 for both shapes. The token was restored in a finally block. This reproduces the API token-update discrepancy without imported SVG and without reusing old shape handles. Automatic propagation is not verified.

Explicit `token.applyToShapes` on the two native button shapes removed their reported bindings without producing the requested test color. Both fills and the token value were restored explicitly to #6D75E8. Native component token propagation remains unverified; do not claim the earlier bindings still exist on this button.

## Desktop SVG chart capture correction

The SVG capture now measures chart text using browser viewport bounds, resolves inherited font styles, and extracts labels outside nested SVG transforms before native text conversion. Regenerated all 26 populated desktop reference states against the existing isolated fixture. The dashboard payload contains 55 nonempty text layers with explicit font sizes. Rotated/multistyle SVG text and exact font baseline matching remain unverified; this correction is not a visual fidelity pass.

Penpot rejects slash-only layer names: the invitations usage counter contains a literal ` / ` text run. The importer now normalizes slash characters in layer names only, preserving text content, and replaces the recorded partial board on retry.

## Mobile native panels

Created native pinned/search empty-state boards with reusable Close, Search input, and Search button components. Roboto 800 is unavailable in the current Penpot font listing; drafts use 700 and do not pass typography fidelity. The live model confirms native text and component instances, but generated SVG omitted text content. Focusing the search board and reading again did not resolve the omission: both panel exports still contain zero `<text>` elements. Local SVG renders cannot verify these panels. See `mobile-conversation-panel-states.md` for source-reviewed state coverage.

## Exact font family correction

A fresh native text read revealed `fontFamily: Roboto Mono` after `findByName('Roboto')`; the same lookup for Inter returned Inter Tight. `findAllByName(...).find(f => f.name === requested)` resolves the exact family. Roboto 800 is available: earlier claims of its absence were based on the wrong family and are superseded.

Corrected 2,394 live text layers page by page (Penpot disallows mutating inactive pages), preserving weights and restoring source weight 800 for mobile headings/search labels. Counts are recorded in `font-corrections.json`; authoring scripts now use exact family matching. This is a design correction, not a production change.

A subsequent fresh read confirms `gfont-roboto` / Roboto, but all rendered `textBounds` values remain null and generated SVG contains zero text nodes for the probe. Thus exact font selection does not resolve the live layout/export omission. `text-layout-after-font-correction.json` preserves the evidence. Live-canvas visibility has been requested from the user to distinguish an editor-layout problem from export-only behavior.

## Overlay text paint-order gap

The importer currently removes all SVG text, imports the remaining vector layout, and appends native text above that layout. This does not preserve original paint order: background conversation text can appear over a modal backdrop in an image-viewer draft. The default viewer payload has 94 text layers, including underlying conversation content. These overlays require a paint-order-preserving conversion before visual verification; native text counts alone are not sufficient evidence.

## In-place native text conversion

SVG IDs are discarded by import; fully transparent fills are removed. A probe with an opaque 1×1 encoded-color marker survived import. Replacing that rectangle through its parent's `insertChild` preserved the text-before-cover order. The preparer now emits unique markers and the importer replaces them in place instead of appending text above all vectors. Empty text removes its marker. Existing drafts require migration; this probe does not establish visual fidelity or repair the separate missing-layout export issue.

All five desktop widget drafts now use in-place native text conversion. A fresh recursive read verified five boards, one vector hierarchy per board, and zero encoded-color markers; see `desktop-widget-layer-verification.json`. Other desktop/web/activity drafts still require migration. The capture now embeds loaded image bytes into SVG and reports failed image captures. A browser check with the app PNG passed; existing references have not yet been regenerated with images.

## Native image preservation

Desktop blob-backed images could be displayed but not fetched by the capture's first embedding path. Serializing already-decoded image pixels through a canvas succeeds for the fixture; both viewer captures now contain two embedded PNG images. Penpot `createShapeFromSvg` dropped image nodes using both href and xlink:href in minimal probes. The preparer now extracts image data into separate payloads and leaves color-coded image rectangles in their original positions; the importer uploads the data through `uploadMediaData` and replaces each marker fill with a native image fill. Object-fit/cropping fidelity and hosted rendering remain unverified.
