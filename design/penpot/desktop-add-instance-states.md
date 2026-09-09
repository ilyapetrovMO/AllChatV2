# Desktop: Add Instance

Status: source reviewed; eleven interaction captures completed; canvas text confirmed; fidelity corrections in progress. This screen is the current desktop completion unit.

References: `populated/desktop-onboarding-reference/manifest.json`. The capture ran successfully in an isolated Electron profile. Visual inspection confirms the keyboard-focused submit outline, native required-field popover, and wrapped insecure-address alert. The alert increases the card height and moves its top edge upward; it must not simply be overlaid onto the default geometry. All eleven state compositions have now been visually inspected; the neutral-pointer recapture also has computed-style checks for default versus hover borders. The required-field JSON confirms `valueMissing: true` and records Chromium's validation copy.

Sources: `desktop/src/renderer/app.tsx:78` (submission), `:320` (entry/rendering), `desktop/src/shared/instance-url.ts:1` (normalization), and `desktop/src/renderer/styles.css:241` (final onboarding styling and subsequent control rules).

Entry: first launch with no instances, or Add Community from an existing desktop shell. The heading changes from “Add your first Instance” to “Add a Community”; both use the same form. The existing-community capture confirms the heading and sidebar instance icon. The application startup message precedes shell-state loading; startup still needs a runtime reference.

| Control/state | Implemented behavior | Evidence |
| --- | --- | --- |
| Community address | Required text input, URL input mode, spellcheck off, placeholder `chat.example` | Source and default capture |
| Address focus | Focus border/shadow; keyboard focus may also receive global outline | Dedicated capture |
| Address hover | Translucent border | Dedicated capture |
| Submit | “Add Instance”; enabled even when empty | Source and default capture |
| Submit hover | Brand hover background | Dedicated capture |
| Submit keyboard focus | Global focus-visible outline | Dedicated capture |
| Empty submit | Native Chromium required-field validation prevents handler | Capture plus validity/message JSON |
| Invalid address | URL parsing exception displayed in `role=alert` below form | Dedicated capture |
| Nonlocal HTTP address | “An Instance must use HTTPS outside local development” alert | Dedicated capture |
| Valid submit | Normalizes address, calls bridge, updates shell state, exits adding/managing mode | Source; transition to sign-in captured in existing desktop reference set |
| Failure recovery | Next submit clears the old error before trying again; input remains editable | Source; insecure-to-invalid error sequence |
| Pending submit | No dedicated spinner, pending label or disabled state in this form | Source; do not invent a loading variant |

Normalization supplies HTTPS for a scheme-less address, permits HTTP only for localhost/loopback, strips query/hash and trailing slash. Native validation belongs to Chromium and must be labeled as such. Error copy from URL parsing can depend on the runtime.

The title bar and Home button are visible shared desktop controls. Their full behavior belongs to the desktop shell inventory; they must remain present in this screen's reconstruction.

## Penpot verification

Page `02 — Desktop`, board `6bdc1c40-ce96-804f-8008-9a624d6665de`. A fresh read found eight Inter text objects, each with a 1×1 automatic box, null rendered bounds, and zero SVG text nodes. An explicit 150×24 fixed box on the Add Instance label also produced null rendered bounds and zero SVG text nodes in a separate call. The diagnostic dimensions were restored. See `desktop-text-sizing-probe.json`.

This rules out automatic box sizing as a sufficient fix for that label. The file API still reports revision 5; persistence and root cause remain unverified. The user supplied a canvas screenshot showing all labels. A subsequent fresh API read returned rendered text (16 SVG text nodes), superseding the missing-layout observation. Hosted PNG export still fails with a hidden 0.01×0.01 SVG; saved persistence remains unverified. No screen or state here is marked visually verified, and no additional Penpot state boards should be multiplied until the baseline renders correctly.

## Remaining completion work

- Preserve the inspected references during reconstruction. Editing the address retains the previous error until resubmission; the successful transition removes the error and shows sign-in. These are application-reference checks, not Penpot fidelity passes.
- Capture startup and applicable window/responsive behavior. Native window minimum is 960×640 (`desktop/src/main/window-policy.ts:7`).
- Resolve live rendering/persistence and compare the editable baseline with the screenshot.
- Reconstruct applicable state variants with reusable address, button and alert components; verify typography, gradients, shadows and focus treatments.
- Attach source/state mappings to Penpot and verify component/token/export round trips.

## Corrections after user canvas evidence

Applied `correct-desktop-add-instance.js` to the existing board: uppercase eyebrow/address labels, address letter spacing, centered text containers, CSS-derived radial background, card shadow and removal of the accidental default input stroke. The live SVG now includes text and the radial gradient; its normalized radius and transform yield a circular radius of about 349px at the 1280×720 viewport, matching the CSS farthest-corner calculation. Shadow blur exports with a 16px Gaussian standard deviation for the source 32px blur. See `desktop-add-instance-live.svg` and `desktop-add-instance-corrections.json`. These structural checks do not yet establish pixel fidelity.

Typography still needs actual runtime-font verification: the CSS lists Inter followed by system fallbacks, so a computed family list alone does not prove which font rendered on Linux or Windows. Do not silently treat cross-platform font differences as a design change.

## Local rendering verification

`generateMarkup` emits the complete board plus repeated descendants at the SVG root. The repeated backgrounds obscure text even though text nodes exist. `render-desktop-baseline.mjs` preserves raw output, renders only the original board subtree, and loads licensed Inter 400/700/800 assets from `fonts/`. The resulting local image visibly shows all labels, uppercase treatments, the centered layout, radial background and card shadow. This is a board-subtree rendering check, not a hosted export or persistence pass.

The imported input rectangle retained a raw SVG stroke despite clearing its API strokes. Replaced it with a native rectangle at the same parent index and geometry; see `desktop-input-background-correction.json`. Final text fidelity remains pending actual application font identification and baseline comparison.

## Runtime font and reusable controls

Chromium `CSS.getPlatformFontsForNode` confirms DejaVu Sans regular/bold on every inspected Linux onboarding element; Inter is only the first declared CSS family, not the rendered font. See `desktop-rendered-fonts.json` and reproducible `inspect-desktop-fonts.mjs`. Penpot lists neither DejaVu Sans nor Segoe UI (`desktop-font-options.json`). The design currently uses an explicit Inter substitution; exact platform typography remains incomplete.

Six native library components on the Desktop page cover button and address input default, hover and keyboard focus. `desktop-onboarding-controls.json` records component/main IDs; `desktop-onboarding-instances.json` records their default instances used in the baseline. Editable placeholder/button text is retained. Focus and hover components still require local visual comparison against their captured states.

Four full-screen interaction boards now use those focus/hover instances; IDs are recorded in `desktop-onboarding-interaction-boards.json`. Their local renders in `desktop-interaction-renders/` have been visually inspected against the corresponding app captures for control placement, outline and fill treatment. Selected color comparisons are in `desktop-interaction-verification.json`. This advances interaction verification but does not close the recorded platform-font or persistence gaps. The default screen was also rendered after component insertion and retains both editable labels at the expected positions.

## Address error designs

Three editable error-state boards now match the measured card top/height changes, address values, error copy and applicable hover/focus controls. `desktop-onboarding-error-boards.json` records IDs. All three local renders in `desktop-error-renders/` were visually inspected against the app references; text font differences remain the previously documented substitution. The edited-address variant intentionally retains the old error until the next submission.

## Existing-community entry and native validation

The existing-community entry is now an editable board (`desktop-add-another-board.json`) with a reusable selected community icon. Its local render `desktop-add-another-render.png` was inspected for the changed heading, sidebar icon, selection marker and preserved form layout.

The Chromium required-field capture is embedded in Penpot as a clearly named raster reference (`desktop-native-validation-reference.json`), with native validation behavior recorded in plugin data. Adjacent default/focus boards provide the editable application UI. It is not misrepresented as an editable browser-popup reconstruction.

The eleven captured states are now represented by the default board, four interaction boards, three error boards, existing-community board, native-validation reference, and the existing sign-in draft for the successful transition. This is capture-set coverage, not full completion: startup/minimum-window behavior, exact platform fonts, token propagation and hosted persistence/export still require verification.
