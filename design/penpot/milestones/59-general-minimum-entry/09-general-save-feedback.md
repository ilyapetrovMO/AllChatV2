# General settings save feedback needs review

Status: needs-triage
Type: task

CommunityAdministration renders the save-error paragraph before the General form (desktop/src/renderer/app.tsx:3358). A local source-derived Chromium DOM probe retains the existing form and inserts the same paragraph after clicking Save settings at the bottom. Scroll anchoring moves scrollTop from531 to599; the error occupies y19.296875–41.6875 above the viewport beginning at76. The form stays visible, but the error does not.

Evidence: design/penpot/milestones/56-community-general-save-error/scroll-probe.json and immediate-failure-reference.png, reproduced with design/penpot/probe-general-save-error-scroll.mjs. This demonstrates the layout risk in a local DOM fixture; a connected React/Electron save-failure reproduction remains required before claiming the full runtime outcome.

Source inspection also shows the update_community_settings success branch updates communitySettings without clearing error. A successful retry can therefore retain prior failure text until another path clears it. No dedicated success or saving indicator is rendered by this handler.

Review where feedback should be displayed, whether it should be brought into view, and how retry feedback should reset. These are product/implementation decisions outside the current static-design work. Milestone56 documents existing rendering and includes an illustrative immediate-failure scroll reference. No production change made.

## Comments

Discovered while auditing General settings static states; broader desktop design coverage remains active.

The milestone59 local960×640 fixture reproduces the same visibility risk: scroll736→804 with the paragraph at y−185.703125…−163.3125, above viewport76. Evidence: design/penpot/milestones/59-general-minimum-entry/scroll-probe.json. Connected React/Electron reproduction remains open.
