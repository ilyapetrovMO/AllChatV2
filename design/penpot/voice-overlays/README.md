# Approved Voice Room overlays

Merged into Desktop — Voice Rooms on September 9, 2026. Canonical self, member, owner, and soundboard board IDs were retained so existing prototype links continue to work. The empty and ten-sound states are canonical examples. Review duplicates and superseded local review exports were removed.

Menus are 288 px wide. Self menus provide profile and copy ID. Other-member menus add local playback volume and messaging. Community Owners additionally receive server mute and disconnect actions in Voice Rooms. Direct Calls do not expose Community moderation. Volume remains 0–100%; the hint distinguishes personal playback volume from moderation.

The soundboard is 360 px wide with two columns of 158 × 44 px sound tiles, 12 px column gaps and 8 px row gaps. Large collections scroll under a fixed header. Long names truncate visually and retain their accessible name and native tooltip. The redundant Community sounds and Choose a sound to play hints are omitted.

Both overlays fit the viewport and support Escape. Their existing actions remain connected to the desktop implementation.

Validation: 121 desktop tests; `npm run test:voice-overlays --workspace=desktop` checks permission layouts, viewport fitting, ten-sound density and forty-sound scrolling; desktop package build passes.

Native Penpot checkpoint: `Approved voice menus and soundboard merged — 2026-09-09`. SVGs are design references; `*-app-*.png` files are rendered implementation checks.
