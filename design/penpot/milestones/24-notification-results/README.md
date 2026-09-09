# Milestone 24 — notification save results and native menus

Six static views: Community save success/failure with All Messages retained; channel save success/failure with Nothing retained; expanded Community and channel level menus. All four notices follow source copy. Failure does not revert local selections. Source: NotificationSettings in app.tsx:3485–3530.

Local Chromium captures verify the native option lists, selection highlight and typography distinction: channel menu uses normal 16px text, Community menu inherits smaller label text. Native appearance and positioning can vary across platforms; no exact cross-platform claim is made. Menu reference screenshots are local only; native designs remain editable shapes/text.

The channel menu initially had invalid text bounds after replacement. Repaired by cloning existing rendered 16px channel-level labels and applying the selected colour through TextRange.fills. Final menu visual inspection and expected-option/text-bound checks pass. Intermediate text-check output is retained as diagnostic history, not final evidence. Final channel-review and frames contain the corrected render. Other five views were visually reviewed as well.

Saved and independently confirmed; see confirmed-version.json. No prototype wiring. Reconstruction: included milestone 23, author-notification-results.js, fix-channel-menu-font.js, then repair-channel-menu-text.js. The final repair applies text-range colours and uses existing 16px labels. Repository MCP SDK/helper, Playwright and milestone 03 fonts support capture/review. This is a reconstruction bundle, not a native .penpot export/reimport.

Remaining: minimum-window layouts, control focus/hover, full runtime geometry/typography comparison, and broader desktop families. Native file-picker investigation remains unresolved.
