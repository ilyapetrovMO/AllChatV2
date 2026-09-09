# Milestone 19 — session revocation confirmation

Two static native boards: session-revocation confirmation and the list after successful revocation. The source calls window.confirm with the device name, returns without mutation on Cancel, and removes the corresponding row after the action resolves. The current session has no Revoke action and remains present.

Captured the actual Electron window.confirm using synthetic session text in a separate Xvfb display, without connecting to an Instance or revoking a session. The native Linux content uses “Ok” and “Cancel”. Its content is recreated with editable shapes/text. Xvfb has no window manager, so the capture has no normal desktop decoration or placement. The design centres the dialog for legibility; that placement is illustrative and explicitly unverified. Inter remains the design font; exact native typography/platform variation is pending. No screenshot was uploaded to Penpot.

Both native boards visually inspected and checked for expected copy, removal/current-session visibility, zero interactions and file validation. Saved version independently confirmed; see confirmed-version.json. Included capture script requires Electron, xvfb-run and ffmpeg; its absolute paths reflect this workspace and must be adjusted elsewhere. The first failed local capture was terminated, then corrected; no capture processes remain running.

Reconstruction: restore the included milestone 15 Sessions base, then run author-session-confirmation.js on Desktop — Main. Repository MCP SDK/helper required. The raw native capture, SVG/PNG designs, IDs, checks and save evidence are included. This is a reconstruction backup, not a native .penpot export/reimport. No new prototype wiring.

Still pending: normal window-manager/platform reference, native file-picker design, remaining control states, settings and other desktop families. Full static coverage is not complete.
