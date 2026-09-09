# Mobile calls and media

Source: `mobile/src/screens/CommunityScreen.tsx:1693–1750,1768–2430,2513–2626`.

| Surface | Controls and implemented states | Verification |
| --- | --- | --- |
| Outgoing call banner | Calling…; Cancel | Source-derived component; native runtime capture pending |
| Incoming call banner | Incoming Direct Call; Accept; Decline | Source-derived component; native runtime capture pending |
| Accepted call banner | Direct Call connected; End | Source-derived component; native runtime capture pending |
| Banner identity | Opens call when onOpen exists; disabled otherwise | Source reviewed; interaction pending |
| Room header | Browse while connected when provided; Leave Voice Room | Source reviewed; runtime pending |
| Microphone | Mute / Unmute, danger styling when muted | Source reviewed; runtime pending |
| Camera | Camera / Stop video; disabled unless connected | Source reviewed; permission and active-video captures pending |
| Camera flip | Switch front and rear camera / ↻ Flip only while camera active | Mobile-specific; runtime pending |
| Screen share | Share screen / Stop sharing; disabled unless connected | Source reviewed; native picker and active states pending |
| Soundboard entry | Sounds appears only when sounds exist | Source reviewed; runtime pending |
| Soundboard dialog | Scrollable sound rows; emoji or Radio fallback; Close; playing closes dialog | Source reviewed; populated capture pending |
| Participant tile | Avatar or video, name, You suffix, connection/video text | Source reviewed; runtime pending |
| Participant interactions | Tap video fullscreen; long-press volume where enabled; disabled without either action | Source reviewed; runtime pending |
| Volume popover | Percentage, drag preview; commit on release/termination; 0–100% accessibility adjustable in 5% steps; outside tap/Back closes | Source reviewed; runtime and assistive-action captures pending |
| Fullscreen video | Native modal; close returns remote screen quality to medium | Source reviewed; runtime pending |
| Compact/browsing state | Return to room, mute, stop camera/share, leave/back controls | Source reviewed; branch-specific capture pending |
| Permissions | Android requests audio and optional camera; non-Android helper returns true | OS references and denied states pending |

Call-banner drafts use the source colors, type sizes, padding, and spacing at the Android capture scale of 2.625 px/dp. Intrinsic button widths and total banner height are provisional until captured from the running native app. A call's accepted state is not proof of media connectivity. These drafts do not count as verified call states.

Participant volume now has source-derived 0%, 50%, and 100% Penpot components (`mobile-volume-components.json`). The 340dp maximum width, 18dp padding, 8dp track and 20dp thumb follow source styles. Overall height, text positions, Android elevation shadow and native rendering remain provisional. Invalid/nonfinite position or nonpositive track width maps to full volume in `participantVolumeFromPosition`; valid values clamp and round to 5% steps.
