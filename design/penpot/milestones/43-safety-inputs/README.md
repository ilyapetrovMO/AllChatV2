# Milestone 43 — Filled Safety forms

Three editable static 1280×800 views show a report addressed to Morgan with a reason, a Timeout moderation action for Morgan with a reason and 30-minute duration, and account deletion with twelve password mask dots and exact DELETE confirmation. All names and values are synthetic. No report, moderation or deletion actions were executed.

Source-derived fixtures were filled locally in Chromium, capturing field bounds, padding, typography, displayed values and validity. All eight sample fields satisfy their native constraints. Native editable text replaces the applicable default selections and fills the existing controls. The report form, moderation middle view and deletion bottom view keep all entered values visible.

Actual SVG/PNG exports were visually checked against local captures. Checks cover copy, field bounds, visible text, removal of stale default selections, zero interactions and Penpot validation. Named save independently confirmed.

Reconstruction: restore included milestone 41 and its milestone 40 prerequisites, run author-safety-inputs.js until remaining is zero (three batches), export initial SVG to settle text, then finish-safety-inputs.js, check-safety-inputs.js and inspect final exports. Repository MCP/Playwright helpers and milestone 03 fonts support the tools. Password measurement uses an explicitly synthetic example-only value; only mask dots are authored into Penpot.

This reconstruction backup is not a native .penpot export or verified reimport. Other selection/input edge cases, validation messages, native dialogs, minimum-window references, full native-control/header/platform typography and broader desktop design coverage remain unfinished. No prototypes or production changes.
