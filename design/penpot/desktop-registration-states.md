# Desktop registration

Source: `desktop/src/renderer/app.tsx:118` and the registration form near `:396`. Entry: Register in Authentication navigation while the active instance has no session. The heading is “Join your Community”; community name and address remain visible.

Invitation token, Username and Password are required. Username uses `autocomplete=username`. Password is masked, has `minLength=12`, and uses `autocomplete=new-password`. Create Account submits all three values with the active instance ID through `bridge.registerInstance`. Submission clears the previous alert; a failure displays the exception message or “Could not register.” The form does not implement a dedicated pending button label or password visibility control. Native required/minimum-length validation must be captured separately from server errors.

The existing board `6bdc1c40-ce96-804f-8008-9a646a6de6ad` now has the source-derived radial background and card shadow, uppercase labels, centered heading/address, three reusable blank input instances, primary submit instance, selected/idle authentication tab instances and selected community icon. `desktop-registration-corrections.json` and `desktop-registration-text-overrides.json` record the changes. Component text is applied in a separate call after initialization.

The default local render `desktop-registration-render.png` was visually inspected for labels, controls, selection and placement. As on the other desktop drafts, Inter substitutes the unavailable runtime platform font; this is not an exact typography pass. Hosted export/persistence and token behavior remain unverified.

Next: capture field focus, button/tab hover, native required/minimum-length validation, filled/masked input, invalid invitation/server errors and successful registration in the disposable fixture; then reconstruct the applicable editable states and label native-browser references. Responsive behavior remains on the desktop verification checklist.

## Registration interaction construction

Five editable boards now cover invitation/username/password focus and submit keyboard-focus/hover. IDs and fresh text reads are recorded in `desktop-registration-state-boards.json`; the authoring script is `author-desktop-registration-states.js`. Each board reuses the existing registration shell and shared input/button variants. Local SVG/PNG exports are in `desktop-registration-state-renders/`.

The first local render exposed stale component placeholder text despite a blank live characters property. Input fills and then text overrides were applied in separate calls and SVGs regenerated. Remaining registration work includes reviewing all resulting renders against captures, filled/masked and error states, browser-owned validation references, and success transitions. Desktop-wide fidelity/export/token gates remain open.

## Filled/error states and transitions

Added three editable boards with shared controls: `registration-filled` (6bdc1c40-ce96-804f-8008-9abd47481b67), `invalid-invitation-error` (6bdc1c40-ce96-804f-8008-9abd483c334e), and `registration-edited-after-error` (6bdc1c40-ce96-804f-8008-9abd4b692a3b). Captured values are applied through separate style/text passes; passwords contain only 29 masking bullets. Local PNGs were visually inspected. Error geometry follows the captured card at y=52, height=688.83, intentionally extending below the viewport; editing retains the three-line error. Typography remains a substitution and has visible width differences from runtime.

Authentication navigation links to the sign-in and recovery drafts. Filled invalid credentials submit to the invalid-invitation state; corrected fixture credentials submit to the existing community-home draft. Fresh link evidence is in `desktop-registration-interaction-verification.json`. These prototype destinations are not a completion claim for recovery/home.

Four native Chromium validation captures remain local and await placement. Automatic approval review rejected screenshot uploads to the connected Penpot file, citing potentially sensitive full UI content and missing specific authorization for the payload/destination. No upload workaround was attempted. User approval is needed for uploading these four references from `populated/desktop-registration-reference/`: invitation-required.png, username-required.png, password-required.png, password-too-short.png.
