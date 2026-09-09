# Approved Voice Room grid

Merged into the canonical Desktop — Voice Rooms designs on September 9, 2026. Draft grids and the duplicated three-participant review board were removed. The connected, muted, and compact screens use the approved layout. Four through seven participants remain as canonical examples.

All cells are equal 16:9 rectangles. Evaluate every possible column count and choose the one with the largest cell width that fits both available dimensions, including 12 px gaps. Center each row independently, including incomplete final rows. Reserve 24 px on the top and sides and 88 px below the stage for room controls. Focus mode retains the participant's grid slot.

For a 1280 × 800 window, the usable grid is 920 × 612 px:

| Participants | Columns | Rows | Cell size |
| --- | --- | --- | --- |
| 3–4 | 2 | 2 | 454 × 255.375 |
| 5–6 | 2 | 3 | 348.444 × 196 |
| 7 | 3 | 3 | 298.667 × 168 |

Implementation: `desktop/src/renderer/voice-grid-layout.ts` and `voice-grid.tsx`. Browser validation: `npm run test:voice-layout --workspace=desktop`.

Penpot checkpoint: `Approved voice grid merged — 2026-09-09`. Recovery backups are retained under `design/penpot/recovery/`.
