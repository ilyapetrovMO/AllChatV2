# Mobile message action sheet

Source: `mobile/src/screens/CommunityScreen.tsx:3262–3368`; native reference `mobile-reference/own-message-actions-light.png`.

- Five quick reactions: 👍, ❤️, 😂, 🎉, 😮. Each invokes onReaction and closes the sheet.
- Reply is always shown when a message is supplied.
- Pin Message becomes Unpin Message when pinned.
- Edit Message and Delete Message appear only for the current member's non-deleted messages; Delete uses danger red.
- Tapping the backdrop or Android Back closes the modal. The outer accessible description is Message actions.
- Without a message the component renders nothing. Action handling and server authorization are delegated outside this component.

The captured variant is an own, non-deleted, unpinned message in light theme. Other-member, pinned, deleted, dark-theme and action-result captures remain pending. The native sheet starts at y1499 and ends at y2400 in the 1080×2400 reference. The editable component preserves measured control positions; top-only corner rounding, emoji fallback rendering, native text metrics, and backdrop reconstruction remain unverified.
