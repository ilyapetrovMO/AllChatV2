# Milestone 21 — Ringtone alternate states

Three static variants: failed replacement retains active custom audio and its reset control; resetting when no Community ringtone exists shows generated-tone fallback while retaining the source-defined Community-reset notice; 50% volume places the thumb and fill at the midpoint. Source: RingtoneSetting and RingtoneSettings in app.tsx:3378 and 3536. These states preserve current implementation, including inconsistent reset wording.

Native labels, conditional reset visibility and no-interaction checks pass, with no file validation issues. All three new native SVG renders visually inspected. Additional prior Ringtone captures are included for context, not a new full-fidelity claim. Saved/confirmed revision 48. No prototype wiring.

Reconstruction: restore included milestone 20, then author-ringtone-variants.js through the repository MCP helper on Desktop — Main. Repository MCP SDK/Playwright and milestone 03 font data support capture/review. This is a reconstruction backup, not a native .penpot export/reimport. IDs, save evidence, checks and raw/rendered artwork are included.

Ringtone hover/focus, minimum-window layouts and exact runtime comparison remain pending. The native file-picker reference is unresolved. Broader desktop design coverage remains active.
