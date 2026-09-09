# Desktop message widgets

Source: `desktop/src/renderer/app.tsx:2781–3100`.

| Widget | Implemented controls and states | Remaining evidence |
| --- | --- | --- |
| Reaction picker | Preset checkboxes expose Add/Remove and checked state; custom input and submit; Enter submits; Escape/outside click closes | Selected preset, invalid/oversized input, focus and failure states |
| Custom reaction | Whitespace rejected; maximum 12 Unicode code points at submission; input maxLength 32; submit disabled only when trimmed empty | Boundary and selected-custom behavior |
| Pending files | Image preview, muted video preview, generic file icon; filename, formatted size, Remove | Image/video variants, multiple files; capture includes generic file |
| File selection | Deduplicates name/size/lastModified; keeps at most ten files | Limit and duplicate interaction references |
| Attachment display | Loading; image opens original; native audio/video controls; name, size, Download | Loading, audio/video OS controls, failed load |
| Original image | “Opening original…” while fetching; lightbox on successful asset response | Fetch progress/error rendering |
| Image viewer | Modal label names image; close button or Escape; wheel zoom 25–800%; left-button drag pans; percentage output | Dragging, limits, keyboard closure and focus behavior |
| Link preview | First detected URL; optional site/title/description/image; hostname/URL fallbacks; opens external tab | Metadata combinations and authenticated image variants |

Attachment load failure is swallowed by the source effect while objectUrl remains null, leaving the Loading label. Original-image fetch uses finally to reset its loading label but has no catch in this component. These are as-built behaviors to document, not changes made by this catalogue task.

The new capture batch writes to `populated/desktop-message-reference/` so existing desktop references are preserved. Captures and eventual native drafts remain unverified until compared, including raster/media content and font metrics.
