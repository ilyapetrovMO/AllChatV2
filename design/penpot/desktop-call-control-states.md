# Desktop call controls

Source: `desktop/src/renderer/app.tsx:2591–2635` (`DirectCallControls`). This is a source-reviewed state map; runtime captures and editable variants remain pending.

| State | Visible controls / behavior |
| --- | --- |
| Idle direct message | Start Call button when no call or voice room exists |
| Outgoing ringing | Cancel Call button calls end |
| Incoming ringing | Incoming Direct Call panel, member name, Accept, Decline |
| Connected direct call | Return-to-DM identity button, connection status, name, soundboard, screen share, mute, End call |
| Connected voice room | Static room identity/status, soundboard, screen share, mute, Disconnect voice |
| Connecting / recovery | Status text substitutes for Connected; not-connected status uses a live status span |
| Unmuted | Mute microphone label/title; toggles first microphone track and sends mute-state |
| Muted | Unmute microphone label/title and muted styling |
| Not sharing | Share screen control opens the native picker through the media path |
| Sharing | Stop sharing screen label and active styling |
| Share failure | Transient status from the error or “Screen sharing failed.” |
| Soundboard empty | Dialog title, Close soundboard, empty-state message |
| Soundboard populated | One button per sound, emoji or ▶ fallback, sound name |
| Shared screens | Local and remote video portals in the matching member tile; local video muted |
| Missing portal target | Controls require desktop-call-controls; video requires the corresponding media member tile |

The connected branch is based on accepted call state or voice-room presence; it does not by itself prove WebRTC connectivity. Status text distinguishes Connecting and Connected. Incoming ringtone, native notification behavior, screen-source picker, participant tiles, and stream recovery require additional runtime verification. No real calls or personal devices were used for this source review.
