# 29 — Polish the Message composer and Attachment selection

**What to build:** Align the Message composer, extend the participant rail to the viewport edge, and show removable previews for selected Attachments before sending.

**Status:** resolved

- [x] The participant rail reaches the bottom and right viewport edges on desktop.
- [x] Add-Attachment and Send controls share the Message input centerline.
- [x] Multiple files can be selected across picker interactions.
- [x] Image Attachments show thumbnails; other files show a file icon, name, and size.
- [x] Each selected Attachment can be removed before sending.
- [x] Removed files are not uploaded and previews clear after a successful Message.
- [x] Desktop, mobile, component, Chromium, and Firefox tests cover the result.

## Answer

Reworked the composer as an explicit overlay layer within the conversation grid, extended the participant rail through the composer row, normalized circular control geometry, and added a client-side Attachment selection model with previews, removal, multiple uploads, and object-URL cleanup.
