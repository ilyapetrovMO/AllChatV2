# Milestone 10 — static main-screen popovers

User direction: every implemented UI surface/control belongs in the design; no new prototyping. Five static native boards were added to Desktop — Main: community menu for owner, community menu for non-owner, presence menu, search filters and notification settings. They are excluded from the prototype viewer and contain no interaction links. Existing historical prototype artifacts were preserved.

Source mapping and remaining coverage are recorded in static-coverage.json. Expected labels, owner-only visibility, editable text bounds and absence of interactions were independently checked. Notification and search-filter renders were visually inspected. Community and presence boards still need rendered visual inspection; they are not marked visually complete. The notification trigger active background was added after comparison with the local runtime reference. No screenshot was uploaded to Penpot.

Notification controls include Community level, Mute Community, Notification sound, Conversation level and Mute conversation. The source-defined select options (Community: All Messages / Mentions Only / Nothing; Conversation: Default plus those three) still need native dropdown reference coverage, along with alternate checkbox and hover/focus states. Presence intentionally includes only Online and Do Not Disturb because these are the implemented choices.

Saved version Desktop design — milestone 10 main popovers, revision 28, independently confirmed. This is a reconstruction backup, not a native .penpot export. Prerequisite main default is included as milestone 07. Restore that board on Desktop — Main, then run author-main-popovers.js. The recipe is additive/idempotent by board name. Run check-main-popovers.js afterward. SHA256SUMS covers all included artifacts.

The family index is a starting coverage ledger, not proof that every desktop control has been inventoried. Continue item-level source review, render the remaining three new boards, then cover message actions, pins, emoji and composer states before moving through other desktop families. The active static-design goal remains unfinished.
