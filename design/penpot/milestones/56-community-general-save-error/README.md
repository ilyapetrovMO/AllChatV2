# Milestone 56 — General save failure

Four editable static1280×800 references cover loaded General save failure: top, middle(scroll500), bottom(scroll599), and an illustrative immediate-failure result from the local DOM probe. The error paragraph says Could not save Community settings. It adds68.390625px before the form, giving content height1203.125 and max scroll599. Source form values and collapsed relay details match milestone52.

A local source-derived Chromium probe retains the form node and inserts the error paragraph after a bottom-position Save click. Scroll anchoring changes531→599, placing the error above the viewport while keeping the form visible. The immediate reference reflects this probe and the clicked Save appearance. This is not a connected React/Electron reproduction; issue09 records that limitation and the source success branch failing to clear earlier error text. No saving/success UI is invented.

Four native exports visually reviewed. Checks cover text positions, error copy/visibility, content dimensions, scroll offsets, all eight controls visible across references, no interactions and file validation. Named save independently confirmed; see confirmed-version.json.

Reconstruction: restore included milestone52 and prerequisites, run author-general-save-error.js, finish-general-save-error.js and check-general-save-error.js, then export/inspect. Helpers require repository MCP/Playwright and milestone03 Inter fonts. Probe/capture scripts remain local and never call a backend.

Reconstruction backup, not native .penpot export or verified reimport. Source captures are synthetic fixtures. Native button/platform font fidelity, valid-input boundaries, expanded relay combinations, minimum window and broader desktop coverage remain open. No prototypes or production edits.
