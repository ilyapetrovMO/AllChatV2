# Sketchboard as-built UI

Source: `internal/instance/web/activities/sketchboard/index.html` and `internal/instance/web/assets/sketchboard.js`. Entry: Activities → Sketchboard (`allchat.sketchboard`), enabled by the Community owner. The activity runs inside an iframe; host chrome is separate from the activity viewport.

| Surface / controls | Implemented states and behavior | Evidence |
| --- | --- | --- |
| Board list | Loading, empty list, populated cards, request failure | List screenshots; loading/error pending |
| Board name / Create board | Required, maximum 80 characters; browser validation; creating text and disabled button; API error | Populated fixture and source; validation/busy/error pending |
| Board card | Name, owner, participant chips or “No active participants”; Enter | Populated list capture |
| Delete | Only when `can_delete`; first click arms “Confirm delete” for four seconds; second disables button during request; failure re-enables | Confirmation capture; deletion busy/error pending |
| Workspace header | Boards navigation, board title, participant names; Clear | All workspace captures |
| Clear | First click arms “Confirm clear” and explanatory status for four seconds; second sends clear; disconnected and clearing statuses | Armed capture; clearing/disconnected pending |
| Drawing tools | Pen, Highlight, Line, Rectangle, Ellipse, Text, Note, Eraser, Pan; selected tool styling | Nine selected-tool captures |
| Text / Note content | Visible only for Text/Note, maximum 240 characters; empty placement focuses field and shows validation; successful placement clears field | Visible-field captures; validation/placement pending |
| Color / Size | Native color picker; range 1–32, default 4 | Default controls captured; native picker and drag states pending |
| Undo / Redo | Undo removes last locally recorded element; redo restores; operation requires connection | Right-scrolled toolbar; operation states pending |
| Zoom out / output / Zoom in | Multiplicative 1.25 steps; clamped 25–300% | Right-scrolled toolbar; limits pending |
| Fit | Resets camera offset and zoom to 100% | Source and toolbar capture |
| Export PNG | Downloads board-name PNG at reset camera, excluding collaboration cursors | Source and toolbar capture; downloaded artifact pending |
| Canvas | Grid, strokes, shapes, text, notes, remote cursors; highlighter opacity 0.3 | Empty canvas capture only; editable grid/content reconstruction pending |
| Connection / presence | WebSocket authentication, participant names, remote cursor interpolation, disconnected status | Single participant captured; multi-user/disconnect pending |

Keyboard implementation: P/H/L/R/O/T/N/E choose tools outside inputs; Ctrl/Cmd+Z undo; Shift+Ctrl/Cmd+Z and Ctrl/Cmd+Y redo. Pan's tooltip advertises Space, but the reviewed keydown handler has no Space branch; the implemented pan gestures are selected Pan, middle button, or Alt-drag. This discrepancy is catalogued rather than silently corrected in the design.

Delete ownership is assigned by `internal/activities/service.go:375` from board owner identity. No owner-only Clear restriction appears in the reviewed frontend control; server authorization still requires separate review.

The toolbar intentionally scrolls horizontally (`activities.css:36`); `workspace-toolbar-right.png` captures its trailing controls. Draft SVG extraction does not yet reconstruct canvas pixels, gradients, native input chrome, or scroll clipping. Screenshots include the host's 48px header while vectors use iframe coordinates. All Penpot boards remain drafts, not visual-fidelity passes.
