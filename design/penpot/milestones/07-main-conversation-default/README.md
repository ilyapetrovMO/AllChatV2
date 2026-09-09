# Milestone 07 — main conversation default

Penpot page Desktop — Main, board Desktop / Main / Text channel. Native 1280×800 desktop layout with 72px rail, 240px channel sidebar, 48px channel header, 240px member directory and message composer. Synthetic Alex/messages are examples; no private screenshot was uploaded. All 31 text layers are editable and have rendered bounds. Native preview was visually inspected; file validation returned no issues.

Saved version Desktop main — milestone 07 conversation default, revision 22, independently confirmed. Board/page IDs and geometry are in checks.json. This is the first layout checkpoint for the next single screen, not a completed navigable main-screen prototype.

Sources: desktop/src/renderer/app.tsx (Community conversations, channel header, message workspace and member directory); desktop/src/renderer/styles.css (community-shell and its child layouts, final cascade); desktop/src/main/window-policy.ts (1280×800 default). Historical desktop-reference/text-channel.png was inspected locally for layout comparison. Typography uses the app-declared Inter working assumption. Icons are editable vector approximations.

Restore by opening/creating Desktop — Main (open-main-page.js), then executing author-main-conversation.js. It needs available Inter and the Penpot plugin API; it does not depend on login IDs or linked external media. This is a reconstruction backup, not a native .penpot export. SHA256SUMS covers included artifacts.

Next within this screen: member-list toggle, search and composer interactions, minimum-window review, and connection from successful login. Settings and voice screens remain outside this milestone. The completed usable login prototype and its previous archives are preserved; its separate tool/fidelity limitations remain documented. Full main desktop goal is still active.
