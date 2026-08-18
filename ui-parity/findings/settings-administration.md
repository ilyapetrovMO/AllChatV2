# Settings and administration parity findings

## Partial native surfaces

- Profile supports fields plus avatar/banner selection, crop/zoom preview, upload, and removal. Rendered crop/output states remain unverified.
- Voice & Video now provides device selection, local volume and processing controls, microphone/camera/speaker tests, reset, and per-Member persistence. Real-device permission and visual comparison states remain unverified.
- Notifications now provides Community defaults, sound and mute controls, per-channel overrides, native delivery status, and save feedback. Rendered comparison remains unverified.
- Admin Dashboard is verified against web: eight live stats, five-second polling, resource and Message charts, proportional storage bars, health states, loading/error handling, and responsive styling. Its packaged comparison is 3.83% against the 5% visual budget.
- Roles and Invitations load and expose create/retire or revoke actions with confirmation. Their complete edit/error and rendered states remain unverified.
- Channels now creates Categories and Text/Voice Channels through the native API and archives/restores Channels. Editing, permission overrides, deletion confirmation, and rendered comparison remain.
- Soundboard now loads, uploads, deletes, and updates maximum clip length through native APIs. Editing, playback, and rendered comparison remain.
- Community General loads and saves attachment limits, Guide Markdown, mobile relay URL, and relay identity through an owner-only native JSON API. Responses without relay identity metadata are normalized for deployment compatibility. Rendered comparison remains.
- Community Administration has a dedicated shell and navigation; user settings are accessible only through the bottom-left cog and are not mixed into administration pages.
- Sessions can load and revoke, but confirmation, empty, and failure states differ.
- Safety exposes reports and moderation data, but reporting and action workflows are incomplete.

## Missing functional equivalents

- Community identity/configuration editing.
- Category/channel editing, permission overrides, and deletion confirmation.
- Role editing and member assignment.
- Soundboard editing and playback.

Implement these from the web source and API contracts; the current read-only summaries must not be treated as parity.
