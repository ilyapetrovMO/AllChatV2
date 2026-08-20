# Messaging parity findings

Compared against the web channel/DM components, assets, API behavior, and the deterministic `desktop-channel-default` render.

## Verified

- The 1280×720 Text Channel shell, spanning header, fixed channel sidebar, member rail, icons, typography, control cursors, and deterministic message fixture are within the configured visual-difference budget.

## Active discrepancies

- Desktop history now automatically loads 50 older messages near the top, pages forward in 100-message batches when returning to present, preserves the prepend scroll anchor, bounds retained history to 300 messages, and renders an active window of at most 80 messages for both Channels and DMs. Reactions render optimistically with rollback; newly sent text still waits for the server response before insertion.
- Following-present mode now re-anchors after delayed image load and audio/video metadata events, so Jump to present includes the final rendered media height without pulling users back down after they intentionally scroll away.
- Web and desktop composers have no redundant Send button: Enter submits, Shift+Enter inserts a newline, and IME composition is not intercepted. Their attachment affordance is the same bare muted icon. Message reply, edit, delete, and pin actions are exposed; their confirmation and rendered-state coverage is not yet equivalent to web.
- Desktop and mobile composers suggest matching Members at a mention boundary and insert the canonical `@username`; returned structured mentions receive dedicated styling. The server-owned structured Member IDs drive browser, mobile, Web Push, mobile push, and native Desktop `mentions_only` decisions. Native Desktop notifications suppress the currently focused conversation and honor Community/conversation mutes and overrides.
- Desktop registers a stable Windows AppUserModelID before notification delivery, allowing packaged builds to participate correctly in the Windows toast-notification system.
- The desktop typing-status strip is part of the composer's opaque surface, preserving contrast when light images scroll underneath it.
- The channel notification menu persists community and conversation policy; permission/recent-notification and rendered-state coverage remain incomplete. Pinned-message filtering exists but still needs rendered-state coverage.
- Search lacks the web filter set and fully equivalent result navigation.
- Links without usable preview metadata remain ordinary message links. Expected 400/422/502 preview responses no longer surface as Electron IPC errors, and the packaged fixture fails on main-process handler or renderer page errors.
- Reactions now open a compact emoji-grid picker, add and remove through the authenticated endpoint, and update both the renderer and the coordinator's authoritative cached/realtime state. This prevents the next realtime publication from replacing a newly accepted Reaction with the pre-action snapshot.
- Media attachments load inline without an extra Open action. Image messages prefer the authenticated `preview_url`; the server bounds that preview to 1280×1280 and encodes large opaque images as quality-82 JPEG (transparent images remain PNG). Audio and video use their original streams because the server does not generate media thumbnails for those formats. The composer supports file selection and drag/drop with image/video/file previews and per-file removal. These states still need rendered cross-client screenshot coverage.
- Authenticated attachment previews and original media are cached in the existing per-Instance SQLite asset cache for 24 hours, survive channel remounts and app restarts, are cleared with the Instance session, and are bounded to 512 entries / 512 MiB per Instance.
- Message URLs are rendered as clickable anchors and only HTTP(S) destinations without embedded credentials are delegated to the operating system browser. Reactions are optimistic before IPC completion, roll back if the request fails, and update the coordinator state consumed by subsequent realtime frames so heartbeat/event publication cannot erase an accepted Reaction. Clicking an inline image loads the cached original into a 60%-black modal viewer with wheel zoom, left-button panning, Escape dismissal, and an explicit close control.
- Member popovers are anchored to their trigger and dismiss on outside click or Escape; their visual cross-client state still needs screenshot coverage.
- DM Home now has the canonical member selection/open-DM workflow. DM blocking/unblocking, composer suppression, and call suppression are implemented; rendered-state coverage remains incomplete.
- Community Guide content does not have an Electron equivalent.

## Next deterministic fixtures

1. Message containing an image attachment, audio attachment, link embed, mention, reply, and reactions.
2. Long conversation with the viewport away from and then returned to the newest edge.
3. DM fixture with member search, blocked state, and unread state.
