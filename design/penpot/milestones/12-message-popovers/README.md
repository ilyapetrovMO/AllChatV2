# Checkpoint 12 — message popovers, save verification pending

Five static boards were created on Desktop — Main: reaction picker with empty/filled custom input, mention suggestions, empty pinned list, populated pinned list. Native structural checks passed for expected controls, 24 preset emoji, text bounds and no interaction links. The source displays pins by filtering the existing message list; no separate pins popover or invented empty-state message was added.

Other-member action and edit-composer renders from milestone 11 were inspected successfully. The five new states have not passed visual inspection: native reaction and mention exports timed out, then the MCP returned No Penpot instance connected for user token. The export process terminated with exit 1. No saved-version claim is made for checkpoint 12. Last confirmed named milestone remains 11 at revision 31.

This local reconstruction checkpoint includes the actually executed author-message-popovers.js and prerequisites 07/11. It preserves the work even if the newly created boards were not autosaved. It is not a native .penpot export. Earlier verified archives are unchanged.

Resume after reconnecting Penpot's MCP plugin: inspect actual current boards before recreating anything; run the idempotent author only if missing. Checkpoint IDs are in boards.json. Render all five states, compare source geometry, and confirm a named saved version. pending-add-selected-reaction-reference.js was NOT applied: the request failed because Penpot disconnected. It adds a message reaction badge to match the picker’s selected thumb-up state; apply/review before marking that state complete. The mention fixture uses two synthetic suggestions; verify directory fixture consistency in the visual review. Preset emoji glyph rendering remains unverified despite nonzero text bounds.

Static coverage remains incomplete. Existing pending message renders (pinned-actions, deleted), hover/focus states, custom emoji validation, reply excerpts/deleted replies, attachments, native dialogs, settings, calls/media and other ledger families remain open. No new prototype was created.
