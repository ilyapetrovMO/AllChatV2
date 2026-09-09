# Desktop sign-in

Source: `desktop/src/renderer/app.tsx:98` and `:368`; styles in `desktop/src/renderer/styles.css:241`, `:256`, `:536`. Entry: an active instance with no session, including successful Add Instance. Community name and base URL identify the instance.

The Authentication navigation has Sign in, Register and Recovery tabs. Sign in is selected through `aria-current=page`. Username is required with `autocomplete=username`; Password is required, masked, and uses `autocomplete=current-password`. This login form has no minimum password length, visibility-toggle button, remember-me control or dedicated submitting indicator. Do not copy the registration/recovery 12-character requirement into login.

Submission clears the previous alert, calls `bridge.loginInstance` with the active instance ID and entered credentials, updates shell state on success, and exits community management. Failure displays the exception message or “Could not sign in.” in an alert below the form. Editing fields alone does not clear that alert. Switching auth tabs does not explicitly clear it either. Native required-field validation prevents empty submission. Runtime references for these additional states remain pending.

The existing default board `6bdc1c40-ce96-804f-8008-9a6463e2cada` has source-backed radial background/card shadow, uppercase field labels, centered heading/subtitle, reusable blank inputs, primary submit button and selected/idle authentication tabs. IDs are recorded in `desktop-sign-in-corrections.json`. Inputs use visually blank text overrides because Penpot rejects an empty characters string. Password-filled states must use masking glyphs, never the entered password. The capture helper now enforces masking; an isolated browser check confirmed no cleartext value appears in its SVG.

The corrected default local render (`desktop-sign-in-render.png`) has been inspected for card, heading, tabs, labels and field placement. That inspection found a missing sidebar selection marker from the old extractor; it was restored and the selected-community component reused (`desktop-sign-in-sidebar.json`). The saved render predates this final sidebar correction and must be refreshed for final comparison.

Thirteen sign-in flow references are now captured in `populated/desktop-sign-in-reference/` (including prerequisite Add Instance and successful home transition). Both native required-field checks reported `valueMissing=true`. All generated SVGs were checked to exclude the entered fixture passwords. Failed login, editing after failure, and Register hover screenshots were visually inspected; the remaining new references require individual review.

The captured error is `Error invoking remote method 'allchat:instance:login': Error: invalid username or password`. It wraps to three lines and moves the card to y=52 with height 645.44 at 1280×720. Editing credentials retains it. Hovering Register gives it the same active fill while Sign in remains selected. Preserve these implemented behaviors rather than simplifying the error or treating hover as navigation.

Remaining: reconstruct captured focus/hover, validation, filled, error and success transitions; document responsive behavior; verify exact platform typography and shared component/token behavior. Hosted export/persistence remains a desktop-wide open gate. These items are not satisfied merely by the default draft or component counts.

Capture timing correction: the first edited-password screenshot showed an incomplete mask run while the SVG recorded 26 bullets. The capture now waits two animation frames after fonts are ready. Recapturing all 13 references completed successfully; visual inspection confirms the edited-password mask is fully painted. This avoids documenting a transient screenshot artifact as an application state.

## Editable interaction/error state review

Eight screen boards now cover username/password focus, submit focus/hover, Register hover, masked filled credentials, failed login and editing after failure (`desktop-sign-in-state-boards.json`). Local renders in `desktop-sign-in-state-renders/` were inspected for fields, labels, error wrapping and control treatments. Component initialization overwrote some same-call text overrides; applying styles and then text in separate calls corrected the placeholders, tab label and masked credentials (`fix-desktop-sign-in-state-text.js`). Renders were regenerated and inspected after correction.

Native username/password validation references still need placement in Penpot. Success leads to the existing community-home draft, which remains a later desktop screen to finish. Exact platform-font and hosted export/persistence gates remain open.

Both native required-field references are now embedded in Penpot (`desktop-sign-in-native-references.json`) with browser-owned labels and validation behavior. Together with the eight editable state boards, default sign-in, prerequisite Add Instance and successful community-home transition, the captured flow is mapped. Responsive behavior, exact platform typography, shared-token behavior and persisted export remain open; sign-in is not marked fully complete.
