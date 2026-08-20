# Web → Electron Parity

Last checked: 2026-08-20

## Summary

| Screen | Layout | Visuals | Behavior | States | Overall |
|---|---|---|---|---|---|
| Community Home | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Text Channel | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Direct Messages Home | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Direct Message | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Voice Room | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Search | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Profile Settings | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Voice & Video Settings | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Notification Settings | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Sessions | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Safety | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Community Settings | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Channel Administration | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Role Administration | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Invitations | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Soundboard | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Admin Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Authentication | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

✅ verified parity · ⚠️ partial or not fully verified · ❌ missing/materially different · ➖ intentional

The default Community Home, Direct Messages Home, Text Channel, Direct Message, and Profile Settings states are verified against both rendered clients at 1280×720. The current packaged-app checks measured 2.78%, 3.96%, 2.71%, 3.66%, and 5.07% meaningful pixel difference respectively. Profile Settings uses a 5.1% budget for the intentional desktop-only Instance rail; the other screens use 5%. The Text Channel fixture also verifies clickable URL rendering and that an unavailable link preview does not emit an Electron handler or renderer error. Other rows remain conservative until equivalent evidence exists.

## Highest-impact gaps

### Voice Room

- ✅ First click connects in place, a second click opens the connected room, and participants are polled and shown beneath every Voice Channel without selecting it.
- ✅ Connected Call and Voice controls occupy the web-style bottom-left connection panel; connected-state actions are absent from the conversation header.
- ⚠️ Participant stage, anchored participant menus, moderation, and disconnect transport exist, but connected and failure states are not visually verified across two packaged clients.

### Message interactions

- ✅ Default Text Channel shell and message feed visual comparison.
- ✅ Language-tagged fenced code blocks, including compact single-line fences, receive JSON/shell syntax highlighting on web and desktop.
- ✅ Web, desktop, and mobile derive notifications from structured Member IDs; `mentions_only` ignores raw `@text`, respects Community/conversation overrides and mutes, and now produces native desktop notifications while the active conversation is focused.
- ⚠️ Desktop and mobile now provide Member mention suggestions and render structured mentions. Keyboard/touch behavior is covered, while open-suggestion rendered screenshot parity remains incomplete.
- ⚠️ Links are clickable; reactions update immediately and survive subsequent realtime frames; images have a cached-original viewer. Channel and DM history use bounded bidirectional pagination, preserve prepend anchors, restore forward history, and re-anchor after delayed media sizing while following present. Reply/edit/delete, pins, link embeds, notification policy, and several rendered states still need complete coverage.
- ⚠️ Native desktop notification delivery is implemented; recent history, operating-system rendered appearance, and several error states remain incomplete.
- ✅ The shared Search control and filter menu are available from every authenticated screen; complete rendered search-state coverage remains tracked under Search.

### Settings and administration

- ✅ The default Profile screen now uses the canonical Member Settings shell, hierarchy, spacing, media rows, form layout, and settings search copy; the packaged comparison is verified at 1280×720.
- ⚠️ Profile upload/editor/error states, Sessions, and Safety still need complete rendered-state coverage.
- ✅ The Community header menu contains only Community Home and owner-only Community Settings; user settings remain on the bottom-left cog.
- ✅ Community Administration uses a dedicated navigation shell; Profile, Voice & Video, Notifications, Sessions, and Safety are no longer shown alongside it.
- ⚠️ Profile image upload now includes a native crop/zoom preview; rendered crop output still needs cross-client verification.
- ⚠️ Voice & Video exposes the web device, processing, preview/test, reset, and persistence controls; real-device and rendered-state coverage remains.
- ⚠️ Notifications exposes Community defaults, sound/mute controls, channel overrides, native permission status, and save errors; rendered comparison remains.
- ✅ Admin Dashboard matches the web eight-stat overview, five-second refresh, CPU/memory/storage histories, 30-minute Message chart, proportional storage breakdown, health states, loading/error behavior, copy, and responsive styling. The packaged comparison measures 3.83% meaningful pixel difference against a 5% budget.
- ⚠️ Role creation/retirement and Invitation creation/revocation are wired to native APIs; edit/empty/error and rendered comparison states remain.
- ⚠️ Channels supports Category/Channel creation and Channel archive/restore; editing, overrides, deletion, and rendered comparison remain.
- ⚠️ Soundboard supports list/upload/delete and maximum clip length through native APIs; edit, playback, error, and rendered comparison states remain.
- ⚠️ Community General loads/saves attachment limits, Guide Markdown, mobile relay URL, and relay identity through a native JSON API, including compatibility with responses that omit relay identity metadata; rendered comparison remains.

### Direct Messages and calls

- ✅ Default Direct Message layout and visuals pass the packaged cross-client comparison.
- ⚠️ DM navigation, messaging, outgoing/incoming calls, and media transport exist.
- ⚠️ Blocked-member behavior and DM Home exist; empty and rendered states remain incomplete.
- ⚠️ Two-client call states and recovery/error behavior need deterministic verification.

### Authentication

- ⚠️ Sign-in, invitation registration, and recovery-token password replacement are native flows with tested server contracts; rendered error states remain.

## Critical flows

| Flow | Status |
|---|---|
| Sign in → open channel → send Message | ⚠️ |
| Receive → react → reply → edit → delete | ⚠️ |
| Attach → preview → send → reopen | ⚠️ |
| Search → open result → return | ⚠️ |
| Open DM → send → start Call → end | ⚠️ |
| Receive Call → accept → talk → end | ⚠️ |
| Join Voice → talk → leave | ⚠️ |
| Update profile → avatar → banner | ⚠️ |
| Configure notifications → channel override | ⚠️ |
| Administer Community | ⚠️ |
| Revoke Session | ⚠️ |

## Intentional differences

- ➖ Electron uses a slim custom draggable titlebar with minimize, maximize/restore, and close controls; parity screenshots compare the application shell beneath it.
- ➖ Electron multi-Instance rail.
- ➖ Native notifications replace browser Web Push permission UI.
- ➖ Persistent authenticated asset caching.

Detailed active findings: [messaging](findings/messaging.md), [media](findings/media.md), and [settings and administration](findings/settings-administration.md).
