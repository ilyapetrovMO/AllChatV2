# Milestone 06 — login focus and hover

Four native editable reference boards show username focus, password focus, Register hover and Submit hover. Browser computed styles are captured in computed-styles.json alongside all four browser renders. Native username-focus and submit-hover renders were visually inspected; all four native boards have valid rendered text bounds and correct 1280×720 geometry. Static references are excluded from the interactive viewer; milestone 03 remains the navigable Penpot flow and milestone 04 the typing/scrolling browser prototype.

Source: desktop/src/renderer/styles.css, including the global focus-visible outline (3px #00A8FC with 2px offset), the focused input border, auth-tab hover and brand-hover button fill. The native focus reference captures the border and outer outline; the low-opacity browser box-shadow is not separately modeled.

Saved version Desktop login — milestone 06 focus and hover, revision 20, independently confirmed via version history. No reopened-file or native reimport claim. This reconstruction archive includes the milestone 03 prerequisite and additive authoring recipe. SHA256SUMS covers its contents.

A reversible main-button corner-radius probe changed 4 to 10; the existing default instance stayed at 4 after a separate read. The main was restored to 4, independently verified, and Penpot validation returned no issues. This establishes that automatic component-change propagation was not observed through this API; it does not establish the underlying hosted Penpot cause. Do not represent the control kit as proven to auto-update all instances.

The login is usable for prototype review, including navigation, typing, validation, retry, recovery, sizes and visible focus/hover states. Full as-built fidelity is still qualified by Inter versus historical Linux DejaVu Sans fallback, unverified component/token automatic propagation, and unavailable native export/reimport. The user authorized continued work using reconstruction backups despite native export failure. Inter is retained as the app-declared working typography, not a recorded user approval.
