# Milestone 03 — navigable desktop login

2026-09-08. Open `login.prototype.html` directly in a browser. Use Fill demo values, then Sign in. Also available: required-field validation, failed login and retry, Register, Recovery, keyboard navigation and restart. All account operations are simulated in memory.

In Penpot, open page **Desktop — Login**, then Play and select **Desktop login — prototype**. Native fields navigate between prepared examples; use the browser artifact for actual typing. The original default board now links into these states too. Authentication is the only implemented area; success ends at a completion panel.

## Saved checkpoint

Penpot file `c828d3cf-7d4e-8145-8008-9a4f1a6ff37f`, page `7299a615-462e-803f-8008-9b83cd5d80df`. Named version **Desktop login — milestone 03 navigable prototype**, observed revision 15. An independent subsequent findVersions call confirmed the named version; see native-snapshot.json. No reopen/reimport claim is made.

Browser prototype committed as `f961ed4` on `prototype/desktop-login-interactive`. Main application code is unchanged. This directory includes the identical standalone HTML and font license for durable use outside the temporary worktree.

## Verification

All 20 native prototype states are reachable. Actual native interactions, happy path, required fields, failed login/correction/retry, registration, recovery and restart paths passed the graph verifier; Penpot file validation returned no issues. The Penpot player itself was not automated. Browser Chromium exercised 15 interaction checks successfully, including keyboard focus and retained errors; no JavaScript errors. See navigation-checks.json and browser-checks.json. Rendered default, error, validation, registration, recovery confirmation, guide and completion states were inspected.

## Backup and restoration

This is a reconstruction backup, not a native .penpot export. Native exports remain unavailable (previous calls failed with `No matching clause`). The archive contains the prior default-screen reconstruction archive, authoring and wiring scripts, compact native shape/navigation snapshot, independent graph checks, previews and self-contained browser prototype. SHA256SUMS covers every included file. Browser restoration requires only opening the HTML. Penpot restoration uses the milestone 02 base instructions, then author-login-prototype.js, then wire-login-prototype.js in a separate execution and verify-login-prototype.js afterward. The MCP runner expects the repository SDK dependency and the configured Penpot URL; credentials are not included. Scripts assume the milestone 02 controls/base board and current login page, so IDs may need mapping in a different file.

## Limits and source mapping

Browser layout derives from desktop/src/renderer/styles.css; authentication behavior references the existing desktop form. Demo account and token checks simulate outcomes. Penpot uses prepared examples and resets tab destinations, while the browser retains errors across edits and tab changes. Inter matches declared app typography but differs from historical Linux fallback captures. Native token automatic propagation and full native export/reimport remain open fidelity checks. No settings or home screen was constructed.

Automatic approval review rejected uploading the home-reference screenshot as sensitive; both prototypes instead end at a generic completion panel, without that upload.
