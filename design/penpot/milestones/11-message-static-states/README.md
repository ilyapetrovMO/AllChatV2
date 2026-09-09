# Milestone 11 — static message and composer states

Six editable static boards on Desktop — Main: own-message actions (Reply/React/Pin/Edit/Delete), other-member actions (Reply/React/Pin/Report), pinned actions (Unpin), deleted message (no actions), reply composer and edit composer, each with Cancel. No prototype interactions were added. The file's validation returned no issues; expected actions and rendered native text were independently checked.

Source: desktop/src/renderer/app.tsx lines 1600–1785; styles.css message-actions and composer rules. Composer height and Cancel geometry were measured from the current CSS in a static browser fixture, not a new interactive prototype. Own-actions and corrected reply-composer renders were inspected. Four other new states still require rendered visual review and more detailed runtime comparison; ledger status remains pending.

Also inspected the three pending milestone 10 menu renders. The non-owner menu's current-user fixture was corrected to Sam while community owner Alex remains in the directory, so the hidden owner option is consistent with the scene. The latest preview includes that correction; earlier milestone 10 archive is unchanged. Updated popover authoring and fixture correction recipes are included.

Saved version Desktop design — milestone 11 reviewed message states, revision 31; independently confirmed. Reconstruction backup includes prerequisite milestone 07. Restore base, then author-message-static-states.js and check-message-static-states.js. On existing milestone 10 boards run fix-member-menu-fixture.js for the corrected non-owner identity. Native .penpot export is not claimed. SHA256SUMS covers artifacts.

This batch is partial static coverage. Emoji picker/custom reaction, reaction selected/unselected counts, reply excerpts/deleted replies, pinned-message pane, mention suggestions, attachments, file drag, typing/error/loading/empty states and other desktop families remain open. Do not mark message/composer families complete from these six boards.
