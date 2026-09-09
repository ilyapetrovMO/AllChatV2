# Milestone 57 — Valid General form boundaries

Two editable static1280×800 views show frontend-valid General input boundaries at scroll531. Minimum: name A, attachment limit1MiB, empty Guide and relay. Maximum: a100-character Community name, attachment limit256MiB and example HTTPS relay. Source data is synthetic. Every changed field is fully visible.

A local standards-mode Chromium fixture attempts101 characters via keyboard entry and retains100. After blur the long name has scrollLeft0 and clips inside the input. The native design keeps all100 characters editable behind a field-content clipping board. Both fixtures pass form.checkValidity; no form submission or backend acceptance is claimed.

Native exports visually reviewed. Checks cover exact field values,100-character length, clipping, source positions, visibility, rendered text, zero interactions and file validation. Named save independently confirmed; see confirmed-version.json.

Reconstruction: restore included milestone52 and prerequisites. Run author-general-valid-boundaries.js twice, then finish-general-valid-boundaries.js. Re-run it after native text layout settles if bounds need realignment, then run check-general-valid-boundaries.js; export and inspect. Helpers require repository MCP/Playwright and milestone03 embedded Inter fonts.

Reconstruction backup, not a native .penpot export or verified reimport. Exact platform typography/native-control appearance, focused long-field scroll/caret behavior, minimum-window views and broader desktop coverage remain open. No prototypes or production edits.
