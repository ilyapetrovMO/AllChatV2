# Safety uses unsupported desktop prompts

Status: needs-triage
Type: task

SafetyPanel calls window.prompt for Resolution outcome (app.tsx:3806) and the purge cutoff timestamp (app.tsx:3887). An isolated sandboxed BrowserWindow using the repository's pinned Electron 43.4.0 throws `Error: prompt() is not supported.` for both. No prompt replacement was found in desktop/src; preload exposes an IPC bridge rather than a prompt override.

Resolve therefore cannot collect an outcome or reach resolve_report through this handler. Purge Old Records cannot collect its timestamp or reach its subsequent confirmation/action. The buttons themselves are present in the static design. Do not invent a functioning native text-input dialog as evidence of current desktop behavior.

Evidence: design/penpot/milestones/45-safety-dialogs/prompt-probes.json and design/penpot/capture-safety-dialogs.cjs. This probes the exact native API and matches the pinned runtime; it is not an end-to-end connected account test.

A product/implementation decision is needed for supported text-entry dialogs, followed by corresponding static design states and action/cancellation validation. Other window.prompt callers exist and need their own scope audit. No production change made during this design milestone.

## Comments

Discovered while checking static Safety dialog coverage. Account deletion uses window.confirm, which did display a native dialog in the same isolated runtime.
