# Safety static design audit

Source: desktop/src/renderer/app.tsx SafetyPanel and settingsView=safety; desktop/src/renderer/styles.css. Scope remains the entire desktop static design. This inventory is not completion evidence.

Member layout: loading; empty report list (no empty-state message in source); member selector closed/open/selected; required member validation; reason empty/entered, minimum 3 and maximum 1000 characters; Submit Report; populated Open Report and Resolved Report; account export button; Delete Account password and exact DELETE confirmation; required/pattern validation and permanent anonymization confirmation; generic action errors and resulting account/navigation state.

Moderator additions when records is present: Resolve on open reports; Resolution outcome prompt and cancellation; Moderation Action form with Warn/Timeout/Suspend/Kick choices, Member selector, Reason and Duration in minutes (minimum zero); Apply Action; collapsed/expanded Moderation Records with action/reason/outcome; Purge Old Records timestamp prompt and permanent purge confirmation. Empty arrays still render moderator controls because arrays are truthy. Export has a download side effect, no local success text in SafetyPanel.

Visual states: relevant focus/hover/disabled states, native dropdowns and validation, long reasons/names and overflow, minimum-window scroll coverage. Native prompts/dialogs require source/runtime confirmation rather than invented web modals.

Milestone 40: Member default top/bottom and loading native designs added. Seven controls have visible references. Rendered text and native SVG/PNG visually checked; file validation and zero-interaction checks pass. Named save independently confirmed. Reconstruction archive extracted and hash verified. Synthetic Member names Alex and Morgan are fixtures. No prototypes or live account actions.

Milestone 41 adds populated Member report top/bottom views, moderator top/middle/bottom views, and expanded Moderation Records. Synthetic open/resolved reports and one warning record illustrate source branches. All moderator controls have visible references. Menus, validation, dialogs, action feedback, input variants, minimum window and full fidelity remain open.

Milestone 42 adds the Report a Member, moderation Action, and moderation Member open menus. Source captures confirm 800px right-aligned popups below 896px controls, 24px rows, cyan focus outline, 14% white hover border and brand-colored focus shadow. Nine options across three menus visually checked, file validation and no-interaction checks pass. Member names are synthetic. Selected/input variants, validation, native dialogs, minimum window, long/empty Member fixtures and full fidelity remain open.
