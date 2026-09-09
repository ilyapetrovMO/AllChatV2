# Mobile notification settings

Correction: the earlier Roboto 800 availability conclusion was wrong. Penpot’s partial-name lookup selected Roboto Mono. Exact family matching finds Roboto with weight 800; the live catalogue font correction is tracked in `font-corrections.json`. Historical fallback notes below describe the earlier draft, not an actual font limitation. Visual verification remains pending.
Source: `mobile/src/screens/CommunityScreen.tsx:4168–4305`; styles at 4848, 4855, 4907, 5088. Component receives initial settings, mode, close handler, and async save handler. Opening/resetting mode copies initial values and clears status.

| State / control | Behavior | Evidence |
| --- | --- | --- |
| Channel mode | “Conversation Notifications”; Default, All Messages, Mentions Only, Nothing | Dark capture and native dialog component |
| Global mode | “Notifications”; omits Default and adds sound toggle | Source reviewed; capture/design pending |
| Selected level | Accent background and white text | Default selected captured; other selections pending |
| Unselected level | Field background and palette text | Three options captured |
| Mute toggle | Muted / Not muted; toggles local value | Not muted captured; muted pending |
| Sound toggle | Global only; Sound on / Sound off | Source reviewed; runtime pending |
| Save | Calls onSave(setting), disables while saving; label becomes “Saving…” | Default captured; saving pending |
| Saved | “Notification settings saved.”; dialog stays open | Source reviewed; runtime pending |
| Save failure | Error message or “Could not save notification settings.” | Source reviewed; runtime pending |
| Close / Android Back | Invokes onClose | Default Close captured; navigation verification pending |
| Backdrop | Transparent native fade modal, black 65% dimming, centered padded card | Captured; backdrop/timeline reconstruction pending |
| Light theme | Palette changes; same conditional structure | Source reviewed; runtime/design pending |

Card reference bounds are [63,596]–[1017,1804] at 1080×2400. The editable component represents the card only. It does not claim reconstruction of the dimmed conversation or OS chrome. Title/label Roboto 800 uses the documented 700 fallback; visual comparison and reusable-instance propagation remain pending. Authorization of settings updates is enforced outside this presentational component and is not yet covered by these references.

Native follow-up captures now cover All Messages selected + Muted, and an expired-session save error reading “authentication required.” The error card expands from 1208px to 1285px tall, shifting the centered dialog upward and Save/Close downward relative to its top. Both have reusable Penpot variants (`mobile-notification-variants.json`). Success and in-flight saving remain uncaptured.

Light-theme native captures and Penpot variants now cover the default and expired-session save-error states. In this run changing Android theme reset the open dialog to Default/Not muted and cleared the error; the capture was relabelled accordingly before separately exercising the light error state. The exact cause of the reset has not been isolated. Both visual comparisons remain pending.
