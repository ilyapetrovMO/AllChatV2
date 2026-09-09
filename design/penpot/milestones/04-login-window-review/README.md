# Milestone 04 — browser login window review

Open login.prototype.html and use Window size to choose minimum 960 × 640 or default 1280 × 800, matching desktop/src/main/window-policy.ts. These controls are outside the simulated product. The previous fluid-width 720px view remains available.

At minimum size Register requires a little vertical scrolling; its submit button remains reachable. All three authentication forms passed submit-reachability checks at both window presets. This supplements the milestone 03 interaction checks; it does not claim all authentication paths were rerun. Window size changes preserve form state.

This checkpoint changes only the browser prototype. Penpot remains at milestone 03, with its 1280 × 720 product boards. Native minimum-window variants, token propagation and native export/reimport remain unfinished login work. The main desktop design goal remains active.

Source is captured on branch prototype/desktop-login-interactive. Earlier milestone archives are unchanged. This self-contained HTML includes its font license. Run the recorded checks in the same workspace with Playwright installed; scripts contain local reference paths.
