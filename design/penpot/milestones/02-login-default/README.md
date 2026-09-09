# Milestone 02 — default desktop login

The default screen has been constructed and visually reviewed in Penpot. This is a checkpoint within the login work, not completion of the entire login part.

Named Penpot version: **Desktop login — milestone 02 default screen**. Revision observed after save: **12**. `reconstruction.json` records a subsequent version-list read, editable geometry, component relationships, colors and typography. `preview.png` is the hosted Penpot render after the icon correction; `app-reference.png` is the Electron Linux reference.

## Backup contents

- `authoring.js` and `finalize.js`: the construction recipe and separate component-label pass, including reusable controls and color tokens.
- `reconstruction.json`: live native shape properties, component identifiers and tokens.
- `preview.png` and `preview.svg`: rendered and vector previews.
- `app-reference.png`, `app-reference.layers.json` and `source-map.json`: source/capture evidence.
- `saved-version.json`, `checks.json`, `token-check.json`: observed save and verification results.
- `SHA256SUMS`: hashes of every other file in this milestone directory.

The sibling `.tar.gz` archive contains this directory. It is a reconstruction backup, **not a native .penpot export**. Plugin native export previously failed for both documented formats; no successful native export or reimport is claimed.

## Reconstruct

In the recorded Penpot file, open an empty page named `Desktop — Login`. Execute `authoring.js` using the Penpot MCP `execute_code` tool, let that call finish, then execute `finalize.js` separately. The authoring script checks the file identity and returns without duplicating an existing default board. For another destination file, inspect its identity and update the script's file guard explicitly before running it. The available Inter font is required. No account credentials are included in this archive.

After reconstruction, export a preview and inspect the heading, three distinct tab labels, blank inputs, submit label and rail icons. Check component links and create a new named version. The recorded shape IDs are evidence of this checkpoint, not requirements for newly reconstructed objects.

## Remaining within login

Focus/hover, filled/invalid-credential states, native required validation, successful-login transition and minimum-window review remain for the next login milestone. The editable screen uses the declared Inter font; the Linux runtime reference uses DejaVu Sans fallback, unavailable in the connected Penpot font library. Exact platform typography is not approved. Color bindings exist, but changing a token value did not propagate to the tested main/instance fills; the original token value was restored. Native file export/reimport and reopen verification remain open. These limitations must be resolved or explicitly reviewed before declaring the full login part finished.

No settings or other app screens were constructed in this milestone.
