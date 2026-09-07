# Collaborative sketchboard features: product research and AllChat priorities

Research date: 2026-08-23

## Question

Which features are common to mature collaborative whiteboards, and which are the highest-value additions to AllChat's bundled realtime Sketchboard? This review covers Miro, FigJam, Excalidraw, Microsoft Whiteboard, and relevant web standards. It uses first-party product documentation, official source repositories, and standards only.

## Executive summary

The mature products converge on six layers:

1. a navigable, effectively unbounded canvas;
2. a compact set of manipulable objects (ink, text, sticky notes, shapes, connectors and images);
3. editing fundamentals (selection, move/resize, erase, undo/redo, copy/paste and ordering);
4. visible collaboration (named cursors, participant presence and follow/presenter controls);
5. asynchronous and meeting workflows (comments, reactions, frames, timer and voting);
6. durable interchange and recovery (automatic persistence, import/export, history or local recovery).

For AllChat, the best next release is not a broad Miro clone. It is a dependable drawing core: infinite pan/zoom, pressure-aware pen and highlighter, stroke eraser, selection/move, multiplayer undo/redo, text/sticky notes, shapes/connectors, live cursors, board export, and keyboard/touch accessibility. Those features compound: selection enables moving, resizing, deletion, duplication and object-level undo; a world-coordinate viewport enables zoom, follow mode and large boards; an object operation model enables conflict-safe realtime editing.

## Evidence from current products

### Miro

Miro's default creation surface includes selection, templates, sticky notes, text, shapes and lines, freehand drawing, frames, media and comments. Frames organize and navigate content, support presentation, and can be exported. Its pen supports color/thickness presets, highlighter, styluses and smart conversion of ink into shapes. ([Miro creation bar](https://help.miro.com/hc/en-us/articles/20967864443410-Miro-s-new-simplified-user-interface), [Frames](https://help.miro.com/hc/en-us/articles/360018261813-Frames), [Pen](https://help.miro.com/hc/en-us/articles/360017730573-Pen))

Miro also treats facilitation as a first-class layer: users can follow another collaborator's viewport, and authorized facilitators can bring one or all participants to their view. Cursor and avatar colors are synchronized so people can identify collaborators. ([Attention management](https://help.miro.com/hc/en-us/articles/360013358479-Attention-management))

Its mobile feature set retains the core objects and collaboration tools—text, shapes, stickies, frames, comments, uploads, connectors, pen/highlighter, lasso and follow—while deliberately omitting or limiting heavier meeting features. Mobile interaction separates view mode from object editing and defines gestures for pan, zoom, selection and movement. ([Miro mobile app](https://help.miro.com/hc/en-us/articles/360017572834-Mobile-app))

### FigJam

FigJam provides drawing/highlighter/eraser, sticky notes, shapes, connectors, text, sections, tables, comments, templates and media. Its meeting layer adds timers, voting, spotlight/follow, stamps, ephemeral emotes and cursor chat. It also exposes widgets as custom collaborative objects. ([Explore FigJam files](https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files), [FigJam meeting tools](https://help.figma.com/hc/en-us/sections/1500000700042-Run-meetings))

The voting design is especially relevant to future prioritization: selections are hidden until the session ends and results are then tallied, which avoids early votes biasing later participants. ([Explore FigJam files](https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files))

FigJam documents keyboard and screen-reader operations for moving objects, editing text and properties, and creating comments. It publishes an explicit support matrix; several spatial-only features, including raw lines, highlights and cursor chat, remain unsupported by screen readers. This is evidence that an accessible object representation must be designed alongside the canvas rather than retrofitted later. ([Use FigJam with a screen reader](https://help.figma.com/hc/en-us/articles/14477051168791-Use-FigJam-with-a-screen-reader))

### Excalidraw

Excalidraw's official repository lists an infinite canvas, image and shape-library support, export to PNG/SVG/clipboard and an open JSON format. Its editing tools include rectangles, circles, diamonds, arrows, lines, free drawing, erasing, arrow binding, labeled arrows, undo/redo, zoom and pan. The hosted app adds realtime collaboration, end-to-end encryption, browser-local autosave, offline/PWA behavior and read-only share links. ([Excalidraw README](https://github.com/excalidraw/excalidraw/blob/master/README.md))

Recent official releases also demonstrate mature-board features such as multiplayer undo/redo, text wrapping, flowcharts, scene search, image cropping, element links, frames and a laser pointer. ([Excalidraw releases](https://github.com/excalidraw/excalidraw/releases))

The important architectural lesson is that drawings are structured scene elements, not only pixels. That representation makes object selection, bindings, conflict resolution, export, accessibility metadata and multiplayer undo possible.

### Microsoft Whiteboard

Microsoft Whiteboard exposes sticky notes, text, images, shapes, customizable pens, highlighter, eraser, lasso selection, undo/redo, sharing and image export in its basic surface. It supports mouse, touch, pen and keyboard. ([Getting started](https://support.microsoft.com/en-us/whiteboard/getting-started-with-microsoft-whiteboard))

Its ink tools add multiple colors and thicknesses, arrow pens, straight-line constraints, a laser pointer and automatic shape recognition. Object workflows include snapping/alignment, front/back ordering and read-only mode; reactions provide lightweight feedback and voting. ([Draw and Ink](https://support.microsoft.com/en-us/whiteboard/draw-and-ink-in-whiteboard), [Tips and Tricks](https://support.microsoft.com/en-us/whiteboard/tips-and-tricks-for-microsoft-whiteboard))

Whiteboard separates edit and read-only permissions. Invitees cannot delete the board or remove its owner, and external access uses specifically addressed guest links rather than broad organization links. ([Collaboration permissions](https://support.microsoft.com/en-us/whiteboard/get-started-with-whiteboard-collaboration), [External sharing](https://support.microsoft.com/en-us/whiteboard/external-sharing))

## Recommended AllChat feature roadmap

### P0: make drawing dependable

- **Infinite viewport with pan, pinch/wheel zoom, fit-to-content and reset view.** Store content in board/world coordinates, independent of viewport size. This is prerequisite infrastructure for large boards, mobile use, collaborator follow and exports.
- **Pen, highlighter and stroke eraser.** Offer a small color palette and useful thickness presets. Use Pointer Events for mouse, touch and pen, retain `pointerId`, and optionally apply `pressure` to width. Pointer Events provide one device-agnostic input model, and pressure is normalized from 0 to 1. ([Pointer Events drawing example](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Using_Pointer_Events), [PointerEvent pressure](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure))
- **Selection and transformation.** Lasso or click-select strokes/objects; move, resize, duplicate and delete them. Selection is the highest-leverage editing primitive.
- **Per-user undo/redo.** Undo the initiating user's last reversible operation rather than rewinding the shared board globally. Excalidraw explicitly ships multiplayer undo/redo, validating this expectation. ([Excalidraw releases](https://github.com/excalidraw/excalidraw/releases))
- **Realtime collaborator cursors and identity.** Throttle cursor/view broadcasts, display name/color, and expire stale cursors using the existing presence lease. Never persist cursor traffic as board history.
- **Reconnect and recovery.** Keep a monotonic board revision; on reconnect request operations since the last acknowledged revision, or fetch a snapshot when the gap is compacted. Make duplicate operations idempotent with client-generated operation IDs.
- **Export.** PNG first, followed by the versioned native JSON scene format. Export should not require owner permission; importing should validate size and schema before mutation.

### P1: make it useful beyond doodling

- **Text and sticky notes**, with editable text, background color and author attribution.
- **Basic shapes and connectors:** rectangle, ellipse, diamond, straight line and arrow; connectors should remain attached as endpoints move.
- **Object ordering and grouping:** bring forward/back, duplicate, group/ungroup and lock.
- **Image insertion** with strict size/type limits and alt text. Treat SVG and externally hosted content as untrusted; rasterize or sanitize before display.
- **Board background:** blank, dots or grid, plus light/dark-safe colors.
- **Named frames/sections** and a small navigator. Frames make a large board understandable and later enable presentation/follow behavior.
- **Comments anchored to objects or coordinates** for asynchronous use. Comments should reuse AllChat identity and notification conventions.

### P2: make calls and workshops better

- **Follow presenter / bring to view**, with a clear exit on the follower's next pan or zoom. Limit forced attention to the board owner or a designated facilitator.
- **Laser pointer** as ephemeral presence traffic, never persisted.
- **Timer** synchronized from a server deadline rather than client countdowns.
- **Reactions and stamps** as lightweight objects; later add private-until-finished voting modeled after FigJam.
- **Templates** composed of normal scene objects, avoiding a parallel data model.
- **Read-only/facilitator modes** independent of board ownership.

### Defer

AI generation, embedded external websites, document conversion, arbitrary plugins/widgets inside Sketchboard, audio/video, and rich third-party media should wait. They expand security, privacy, moderation and storage scope much faster than they improve the bundled call experience.

## Realtime and data-model implications

Replace a stroke-only log with a versioned scene-operation envelope while retaining append-only server ordering:

```json
{
  "operation_id": "client-generated UUID",
  "actor_id": "server-derived member ID",
  "base_revision": 41,
  "kind": "object.update",
  "object_id": "UUID",
  "payload": { "x": 120, "y": 80 },
  "server_revision": 42
}
```

The server must derive actor and authorization from the Activity Session, validate operation kind and payload bounds, assign the authoritative revision, and deduplicate `operation_id`. Use explicit object create/update/delete operations. Treat clear-board as an owner-authorized batch/tombstone operation rather than deleting history immediately. Snapshot periodically and retain enough operations for reconnect and audit. Ephemeral cursor, viewport, laser and in-progress-stroke messages belong on a lossy/throttled presence channel; committed objects belong in durable ordered state.

Per-user undo should append an inverse operation that references the original operation. If another collaborator has since changed the same object, reject or safely transform the inverse and explain the conflict rather than silently destroying their work.

## Security and moderation

- Preserve creator ownership, but add separate board roles: owner, editor and viewer. Never accept actor IDs, roles, ownership or server revisions from the iframe.
- Apply server-side limits to board object count, points per stroke, operation bytes and rate; simplify/coalesce pointer samples before broadcast and persistence. This prevents accidental overload and deliberately enormous paths.
- Validate every numeric coordinate as finite and bounded. Reject unknown operation kinds and properties. Normalize text length and disallow active HTML.
- For images, allow-list decoded raster formats, enforce decoded dimensions and byte limits, strip metadata, store through an Instance-controlled endpoint, and require alt text. Do not load arbitrary remote URLs from the sandbox.
- Keep destructive actions recoverable: two-step in-app confirmation, ownership enforcement, tombstones and a retention window. Sandboxed browser dialogs are not reliable host UI.
- Record board create/delete, permission changes and bulk-clear as audit events. Provide participant reporting/moderation hooks before public or link-based sharing.
- Activity tokens remain short-lived, audience-scoped and unusable for general APIs; WebSocket authentication should continue in the first message rather than a logged URL.

## Accessibility and mobile requirements

Canvas pixels alone do not expose meaningful structure. Maintain an accessible DOM/object list synchronized with the scene, with names such as “Blue sticky note by Alex: deployment risks,” keyboard selection and object actions. Microsoft documents keyboard and screen-reader creation, editing and sharing; Miro supports keyboard/assistive create-read-update-delete and labels/descriptions/actions for board objects. ([Microsoft screen-reader tasks](https://support.microsoft.com/en-US/whiteboard/basic-tasks-using-a-screen-reader-with-microsoft-whiteboard), [Miro accessibility overview](https://help.miro.com/hc/en-us/articles/19506114302354-Overview-of-Miro-Accessibility))

- All toolbar actions need semantic buttons, visible focus, labels, shortcuts and a non-drag alternative. WCAG 2.2 requires functionality that uses dragging to also work through a non-drag interaction, and sets a 24-by-24 CSS-pixel AA minimum target subject to its spacing exceptions; prefer 44-by-44 for the mobile toolbar. ([WCAG 2.2 changes](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [WCAG enhanced target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced))
- Do not encode collaborator, pen or sticky identity using color alone. Name colors in controls, maintain contrast, support reduced motion and expose text alternatives for images.
- Use Pointer Events and pointer capture for all drawing devices. Handle `pointercancel` and multiple pointer IDs. Avoid a single global mouse flag.
- On touch, default to navigation/view mode and require an explicit pen/select tool before mutating objects, following Miro's approach. Support one-finger drawing only while a drawing tool is active and two-finger pan/zoom throughout.
- Avoid blanket `touch-action: none` outside the drawing surface because it can prevent browser zoom for users with low vision. Define gesture ownership narrowly and supply explicit zoom controls. ([MDN `touch-action` accessibility note](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action))
- Keep the compact mobile toolbar scrollable or expandable and keep destructive controls away from drawing controls. Test Android/iOS touch, stylus pressure, desktop mouse, trackpad, keyboard-only, screen reader and 200% text zoom.

## Suggested acceptance criteria for the first enhancement batch

1. Two users can concurrently draw, see named cursors, disconnect/reconnect, and converge on the same scene without duplicate operations.
2. Either user can undo only their own most recent eligible action; the other user's work remains.
3. Mouse, touch and pen can draw; two-finger pan/zoom never produces accidental strokes.
4. Users can pan, zoom, fit content, erase a stroke, select/move an object, add text/sticky/shape, and export PNG.
5. Toolbar controls are keyboard reachable, visibly focused, named to assistive technology and at least 44 CSS pixels on the mobile layout.
6. Server rejects oversized, malformed, non-finite, unknown and unauthorized operations without dropping healthy collaborators.
7. Reload and reconnect recover the persisted scene and current viewport safely; ephemeral cursors and laser pointers are absent from history.

## Sources

The links cited inline are the source list. Product claims use official Miro, Figma and Microsoft documentation or Excalidraw's official source repository; platform requirements use W3C standards/guidance and MDN's standards-oriented web API documentation.
